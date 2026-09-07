import { Injectable } from '@nestjs/common';
import { PageMeta } from '@wcies/shared';
import { platformCodeOfFulfillmentMode } from '../../platform/constants/platform.constants';
import { StoreService } from '../../store/services/store.service';
import {
  OperatorContext,
  OperationLogService,
  diffOf,
} from '../../operation-log/operation-log.service';
import { StoreWarehouseBindingEntity } from '../entities/store-warehouse-binding.entity';
import {
  StoreWarehouseBindingInvalidError,
  StoreWarehouseBindingNotFoundError,
  WarehouseNotFoundError,
} from '../errors/warehouse-errors';
import { WarehouseRepository, BindingRowWithRefs } from '../repositories/warehouse.repository';
import {
  BindingListQueryDto,
  BindingResponseDto,
  CreateBindingRequestDto,
  UpdateBindingRequestDto,
} from '../dto/warehouse.dto';
import { offsetOf } from '../../../common/dto/pagination.dto';

const ENTITY_TYPE = 'STORE_WAREHOUSE_BINDING';

/**
 * Which warehouse types a fulfillment mode may bind to (task §45 +
 * spec §83). Platform-fulfilled modes (FBO/FBY/FBW) bind PLATFORM
 * warehouses; seller-fulfilled modes bind SELF / THIRD_PARTY. Kept in the
 * service layer on purpose - never hardcoded in the database.
 */
const MODE_ALLOWED_WAREHOUSE_TYPES: Record<string, string[]> = {
  OZON_RFBS: ['SELF', 'THIRD_PARTY'],
  OZON_FBS: ['SELF', 'THIRD_PARTY'],
  OZON_FBP: ['SELF', 'THIRD_PARTY'],
  OZON_FBO: ['PLATFORM'],
  WB_FBS: ['SELF', 'THIRD_PARTY'],
  WB_FBW: ['PLATFORM'],
  YANDEX_FBS: ['SELF', 'THIRD_PARTY'],
  YANDEX_FBY: ['PLATFORM'],
};

/**
 * Store N:M Warehouse bindings (task §42-§45).
 * Validates: store platform matches fulfillment mode; warehouse type matches
 * the mode. One physical warehouse may serve many stores (e.g. Shenzhen).
 */
@Injectable()
export class StoreWarehouseBindingService {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly storeService: StoreService,
    private readonly operationLog: OperationLogService,
  ) {}

  async list(
    query: BindingListQueryDto & { page: number; pageSize: number },
  ): Promise<{ items: BindingResponseDto[]; meta: PageMeta }> {
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.listBindingsWithRefs(
      { storeId: query.storeId, warehouseId: query.warehouseId, status: query.status },
      pageSize,
      offsetOf(page, pageSize),
    );
    return { items: rows.map((row) => this.toResponse(row)), meta: { page, pageSize, total } };
  }

  async listByStore(
    storeId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ items: BindingResponseDto[]; meta: PageMeta }> {
    return this.list({ storeId, ...page });
  }

  async create(
    storeId: string,
    dto: CreateBindingRequestDto,
    operator: OperatorContext,
  ): Promise<BindingResponseDto> {
    const storeWithPlatform = await this.storeService.getEntityWithPlatform(storeId);
    if (storeWithPlatform === null) {
      throw new StoreWarehouseBindingInvalidError(`Store not found: ${storeId}`);
    }
    const warehouse = await this.repository.findWarehouseById(dto.warehouseId);
    if (warehouse === null) {
      throw new WarehouseNotFoundError(dto.warehouseId);
    }

    // Platform consistency: WB store + OZON_FBO must be rejected (task §45).
    const modePlatform = platformCodeOfFulfillmentMode(dto.fulfillmentMode);
    if (modePlatform !== storeWithPlatform.platformCode) {
      throw new StoreWarehouseBindingInvalidError(
        `Fulfillment mode ${dto.fulfillmentMode} belongs to platform ${modePlatform}, ` +
          `but the store belongs to ${storeWithPlatform.platformCode}`,
        {
          storeId,
          fulfillmentMode: dto.fulfillmentMode,
          storePlatform: storeWithPlatform.platformCode,
        },
      );
    }

    // Warehouse type consistency (service layer, task §45).
    const allowed = MODE_ALLOWED_WAREHOUSE_TYPES[dto.fulfillmentMode] ?? [];
    if (!allowed.includes(warehouse.warehouseType)) {
      throw new StoreWarehouseBindingInvalidError(
        `Fulfillment mode ${dto.fulfillmentMode} requires warehouse type ${allowed.join('/')}, ` +
          `got ${warehouse.warehouseType}`,
        { warehouseId: warehouse.id, warehouseType: warehouse.warehouseType, allowed },
      );
    }

    const duplicate = await this.repository.findBinding(storeId, warehouse.id, dto.fulfillmentMode);
    if (duplicate !== null) {
      throw new StoreWarehouseBindingInvalidError(
        `Binding already exists for this store + warehouse + fulfillment mode`,
        { existingBindingId: duplicate.id },
      );
    }

    const binding = await this.repository.insertBinding({
      storeId,
      warehouseId: warehouse.id,
      fulfillmentMode: dto.fulfillmentMode,
      platformWarehouseId: dto.platformWarehouseId ?? null,
      isInventorySource: dto.isInventorySource ?? true,
      isInventoryPushEnabled: dto.isInventoryPushEnabled ?? false,
      priority: dto.priority ?? 100,
      settings: dto.settings ?? null,
      status: 'ACTIVE',
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: binding.id,
      entityCode: `${storeId}->${warehouse.warehouseCode}/${dto.fulfillmentMode}`,
      action: 'CREATE',
      changes: { fulfillmentMode: { from: null, to: binding.fulfillmentMode } },
      operator,
    });
    return this.toResponse({
      binding,
      storeCode: storeWithPlatform.store.storeCode,
      storeName: storeWithPlatform.store.name,
      platformCode: storeWithPlatform.platformCode,
      warehouseCode: warehouse.warehouseCode,
      warehouseName: warehouse.name,
    });
  }

  async update(
    storeId: string,
    bindingId: string,
    dto: UpdateBindingRequestDto,
    operator: OperatorContext,
  ): Promise<BindingResponseDto> {
    const binding = await this.findOwnedOrThrow(storeId, bindingId);
    const before = this.snapshot(binding.binding);
    const patch: Partial<StoreWarehouseBindingEntity> = {};
    if (dto.platformWarehouseId !== undefined) patch.platformWarehouseId = dto.platformWarehouseId;
    if (dto.isInventorySource !== undefined) patch.isInventorySource = dto.isInventorySource;
    if (dto.isInventoryPushEnabled !== undefined)
      patch.isInventoryPushEnabled = dto.isInventoryPushEnabled;
    if (dto.priority !== undefined) patch.priority = dto.priority;
    if (dto.settings !== undefined) patch.settings = dto.settings;
    if (dto.status !== undefined) patch.status = dto.status;
    if (Object.keys(patch).length > 0) {
      await this.repository.updateBinding(bindingId, patch);
    }
    const updated = await this.findOwnedOrThrow(storeId, bindingId);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: bindingId,
      entityCode: `${storeId}->${updated.binding.warehouseId}`,
      action: 'UPDATE',
      changes: diffOf(before, this.snapshot(updated.binding)),
      operator,
    });
    return this.toResponse(updated);
  }

  async setStatus(
    storeId: string,
    bindingId: string,
    status: 'ACTIVE' | 'DISABLED',
    operator: OperatorContext,
  ): Promise<BindingResponseDto> {
    const binding = await this.findOwnedOrThrow(storeId, bindingId);
    await this.repository.updateBinding(bindingId, { status });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: bindingId,
      entityCode: `${storeId}->${binding.binding.warehouseId}`,
      action: status === 'ACTIVE' ? 'ENABLE' : 'DISABLE',
      changes: { status: { from: binding.binding.status, to: status } },
      operator,
    });
    return this.toResponse(await this.findOwnedOrThrow(storeId, bindingId));
  }

  private async findOwnedOrThrow(storeId: string, bindingId: string): Promise<BindingRowWithRefs> {
    const binding = await this.repository.findBindingById(bindingId);
    if (binding === null || binding.storeId !== storeId) {
      throw new StoreWarehouseBindingNotFoundError(bindingId);
    }
    const storeWithPlatform = await this.storeService.getEntityWithPlatform(storeId);
    const warehouse = await this.repository.findWarehouseById(binding.warehouseId);
    if (storeWithPlatform === null || warehouse === null) {
      throw new StoreWarehouseBindingNotFoundError(bindingId);
    }
    return {
      binding,
      storeCode: storeWithPlatform.store.storeCode,
      storeName: storeWithPlatform.store.name,
      platformCode: storeWithPlatform.platformCode,
      warehouseCode: warehouse.warehouseCode,
      warehouseName: warehouse.name,
    };
  }

  private snapshot(binding: StoreWarehouseBindingEntity): Record<string, unknown> {
    return {
      platformWarehouseId: binding.platformWarehouseId,
      isInventorySource: binding.isInventorySource,
      isInventoryPushEnabled: binding.isInventoryPushEnabled,
      priority: binding.priority,
      settings: binding.settings,
      status: binding.status,
    };
  }

  private toResponse(row: BindingRowWithRefs): BindingResponseDto {
    return {
      id: row.binding.id,
      storeId: row.binding.storeId,
      storeCode: row.storeCode,
      storeName: row.storeName,
      platformCode: row.platformCode,
      warehouseId: row.binding.warehouseId,
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
      fulfillmentMode: row.binding.fulfillmentMode,
      platformWarehouseId: row.binding.platformWarehouseId,
      isInventorySource: row.binding.isInventorySource,
      isInventoryPushEnabled: row.binding.isInventoryPushEnabled,
      priority: row.binding.priority,
      settings: row.binding.settings,
      status: row.binding.status,
      createdAt: row.binding.createdAt,
      updatedAt: row.binding.updatedAt,
    };
  }
}
