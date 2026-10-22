import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PageMeta } from '@wcies/shared';
import {
  OperationLogService,
  OperatorContext,
  diffOf,
} from '../../operation-log/operation-log.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { PlatformService } from '../../platform/platform.service';
import { PlatformNotFoundError } from '../../platform/errors/platform-errors';
import { StoreEntity } from '../entities/store.entity';
import {
  StoreCodeAlreadyExistsError,
  StoreInUseError,
  StoreNotFoundError,
} from '../errors/store-errors';
import { StoreRepository, StoreRowWithCounts } from '../repositories/store.repository';
import {
  CreateStoreRequestDto,
  StoreListItemDto,
  StoreListQueryDto,
  StoreResponseDto,
  UpdateStoreRequestDto,
} from '../dto/store.dto';
import { offsetOf } from '../../../common/dto/pagination.dto';

const ENTITY_TYPE = 'STORE';

/** Store master data: per-platform seller accounts (task §8/§9). */
@Injectable()
export class StoreService {
  constructor(
    private readonly repository: StoreRepository,
    private readonly platformService: PlatformService,
    private readonly businessCode: BusinessCodeService,
    private readonly operationLog: OperationLogService,
    private readonly config: ConfigService,
  ) {}

  async list(
    query: StoreListQueryDto & { page: number; pageSize: number },
  ): Promise<{ items: StoreListItemDto[]; meta: PageMeta }> {
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.listWithCounts(
      {
        platformId: query.platformId,
        status: query.status,
        keyword: query.keyword?.trim() || undefined,
      },
      pageSize,
      offsetOf(page, pageSize),
    );
    return {
      items: rows.map((row) => this.toListItem(row)),
      meta: { page, pageSize, total },
    };
  }

  async create(dto: CreateStoreRequestDto, operator: OperatorContext): Promise<StoreResponseDto> {
    const platform = await this.platformService.getEntityById(dto.platformId);
    if (platform === null) {
      throw new PlatformNotFoundError(dto.platformId);
    }
    // Auto-coded per platform scope (ON/WS/YX-%03d) when omitted (decision #4).
    const manualCode = dto.storeCode?.trim();
    if (manualCode !== undefined && manualCode !== '') {
      const existing = await this.repository.findByPlatformAndCode(platform.id, manualCode);
      if (existing !== null) {
        throw new StoreCodeAlreadyExistsError(platform.id, manualCode);
      }
    }
    const storeCode = manualCode || (await this.businessCode.nextStoreCode(platform.code));

    const store = await this.repository.insert({
      platformId: platform.id,
      storeCode,
      name: dto.name,
      sellerId: dto.sellerId ?? null,
      defaultCurrency: dto.defaultCurrency ?? null,
      status: 'ACTIVE',
      settings: dto.settings ?? null,
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: store.id,
      entityCode: store.storeCode,
      action: 'CREATE',
      changes: {
        storeCode: { from: null, to: store.storeCode },
        name: { from: null, to: store.name },
      },
      operator,
    });
    return this.toResponse(store, platform.code, platform.name);
  }

  async getById(id: string): Promise<StoreResponseDto> {
    const found = await this.findWithPlatformOrThrow(id);
    return this.toResponse(found.store, found.platformCode, found.platformName);
  }

  async update(
    id: string,
    dto: UpdateStoreRequestDto,
    operator: OperatorContext,
  ): Promise<StoreResponseDto> {
    const found = await this.findWithPlatformOrThrow(id);
    const before = this.snapshot(found.store);
    const patch: Partial<StoreEntity> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.sellerId !== undefined) patch.sellerId = dto.sellerId;
    if (dto.defaultCurrency !== undefined) patch.defaultCurrency = dto.defaultCurrency;
    if (dto.settings !== undefined) {
      // Read-modify-write (Sprint 9 T2): the whole settings column is NULL
      // on real stores, and callers toggle ONE key (e.g. sync.orderSyncEnabled)
      // - a blind replace would wipe every other setting. Top-level keys in
      // the payload win; absent keys keep their stored value.
      patch.settings = { ...(found.store.settings ?? {}), ...dto.settings };
    }

    if (Object.keys(patch).length > 0) {
      await this.repository.update(id, patch);
    }
    const updated = await this.findWithPlatformOrThrow(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: updated.store.storeCode,
      action: 'UPDATE',
      changes: diffOf(before, this.snapshot(updated.store)),
      operator,
    });
    return this.toResponse(updated.store, updated.platformCode, updated.platformName);
  }

  async setStatus(
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    operator: OperatorContext,
  ): Promise<StoreResponseDto> {
    const found = await this.findWithPlatformOrThrow(id);
    await this.repository.update(id, { status });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: found.store.storeCode,
      action: status === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE',
      changes: { status: { from: found.store.status, to: status } },
      operator,
    });
    const updated = await this.findWithPlatformOrThrow(id);
    return this.toResponse(updated.store, updated.platformCode, updated.platformName);
  }

  /** Cross-module entity lookup (binding / listing services). */
  /** All ACTIVE stores (sync scheduler iteration). */
  async listAllActive(): Promise<StoreEntity[]> {
    return this.repository.listByStatus('ACTIVE');
  }

  /** Zero-reference hard delete (decision 0003); referenced -> STORE_IN_USE. */
  async remove(id: string, operator: OperatorContext): Promise<void> {
    const found = await this.findWithPlatformOrThrow(id);
    const references = await this.repository.countReferences(id);
    const used = references.filter((reference) => reference.count > 0);
    if (used.length > 0) {
      throw new StoreInUseError(used.map((reference) => reference.table));
    }
    await this.repository.delete(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: found.store.storeCode,
      action: 'DELETE',
      changes: { deleted: { from: found.store.storeCode, to: null } },
      operator,
    });
  }

  /** Cross-module store lookup by platform + store code (webhook routing). */
  async getEntityByPlatformAndCode(
    platformId: string,
    storeCode: string,
  ): Promise<StoreEntity | null> {
    return this.repository.findByPlatformAndCode(platformId, storeCode);
  }

  async getEntityById(id: string): Promise<StoreEntity | null> {
    return this.repository.findById(id);
  }

  /** Store + owning platform, used for fulfillment-mode validation. */
  async getEntityWithPlatform(
    id: string,
  ): Promise<{ store: StoreEntity; platformCode: string } | null> {
    const store = await this.repository.findById(id);
    if (store === null) {
      return null;
    }
    const platform = await this.platformService.getEntityById(store.platformId);
    if (platform === null) {
      return null;
    }
    return { store, platformCode: platform.code };
  }

  private async findWithPlatformOrThrow(
    id: string,
  ): Promise<{ store: StoreEntity; platformCode: string; platformName: string }> {
    const store = await this.repository.findById(id);
    if (store === null) {
      throw new StoreNotFoundError(id);
    }
    const platform = await this.platformService.getEntityById(store.platformId);
    if (platform === null) {
      throw new PlatformNotFoundError(store.platformId);
    }
    return { store, platformCode: platform.code, platformName: platform.name };
  }

  private snapshot(store: StoreEntity): Record<string, unknown> {
    return {
      name: store.name,
      sellerId: store.sellerId,
      defaultCurrency: store.defaultCurrency,
      settings: store.settings,
    };
  }

  private toListItem(row: StoreRowWithCounts): StoreListItemDto {
    return {
      ...this.toResponse(row.store, row.platformCode, row.platformName),
      credentialConfigured: row.credentialConfigured,
      bindingCount: row.bindingCount,
    };
  }

  private toResponse(
    store: StoreEntity,
    platformCode: string,
    platformName: string,
  ): StoreResponseDto {
    return {
      id: store.id,
      platformId: store.platformId,
      platformCode,
      platformName,
      storeCode: store.storeCode,
      name: store.name,
      sellerId: store.sellerId,
      defaultCurrency: store.defaultCurrency,
      status: store.status,
      settings: store.settings,
      webhookUrl: this.webhookUrlOf(platformCode, store.storeCode),
      createdAt: store.createdAt,
      updatedAt: store.updatedAt,
    };
  }

  /**
   * 入站 webhook 回调地址（2026-10-22，用户要求店铺配置里可见）：
   * 平台按 `{PUBLIC_BASE_URL}/api/v1/webhooks/{platform}/stores/{storeCode}`
   * 投递。OZON 由本系统 API 订阅、WB 由本系统创建订阅、Yandex 只能去卖家
   * 后台「API 通知」手填——三者都需要操作者知道这条地址，所以统一在店铺详情
   * 返回，前端分平台给说明。
   */
  private webhookUrlOf(platformCode: string, storeCode: string): string | null {
    if (!['OZON', 'WB', 'YANDEX'].includes(platformCode)) {
      return null;
    }
    const base = this.config.get<string>('app.publicBaseUrl')?.replace(/\/+$/, '');
    if (base === undefined || base === '') {
      return null;
    }
    return `${base}/api/v1/webhooks/${platformCode.toLowerCase()}/stores/${storeCode}`;
  }
}
