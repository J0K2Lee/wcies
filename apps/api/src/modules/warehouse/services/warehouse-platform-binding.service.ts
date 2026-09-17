import { Injectable } from '@nestjs/common';
import { PageMeta } from '@wcies/shared';
import { platformCodeOfFulfillmentMode } from '../../platform/constants/platform.constants';
import { StoreService } from '../../store/services/store.service';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { WarehousePlatformBindingEntity } from '../entities/warehouse-platform-binding.entity';
import {
  WarehouseNotFoundError,
  WarehousePlatformBindingInvalidError,
  WarehousePlatformBindingNotFoundError,
} from '../errors/warehouse-errors';
import {
  WarehouseRepository,
  PlatformBindingRowWithRefs,
} from '../repositories/warehouse.repository';
import { CreatePlatformBindingRequestDto, PlatformBindingResponseDto } from '../dto/warehouse.dto';
import { offsetOf } from '../../../common/dto/pagination.dto';

const ENTITY_TYPE = 'WAREHOUSE_PLATFORM_BINDING';

/**
 * 哪些仓库类型允许绑定哪种履约模式的平台仓库（用户指示 2026-09-17，
 * OZON 规则：自管仓→rFBS/FBS、半托管→FBP、托管仓→FBO）。保留在服务层，
 * 不写死在数据库（同旧 MODE_ALLOWED_WAREHOUSE_TYPES 的约定）。
 */
const MODE_ALLOWED_WAREHOUSE_TYPES: Record<string, string[]> = {
  OZON_RFBS: ['SELF', 'THIRD_PARTY'],
  OZON_FBS: ['SELF', 'THIRD_PARTY'],
  WB_FBS: ['SELF', 'THIRD_PARTY'],
  YANDEX_FBS: ['SELF', 'THIRD_PARTY'],
  OZON_FBP: ['SEMI_MANAGED'],
  OZON_FBO: ['PLATFORM'],
  WB_FBW: ['PLATFORM'],
  YANDEX_FBY: ['PLATFORM'],
};

/**
 * 仓库 → 平台仓库绑定（用户指示 2026-09-17）。
 *
 * 校验：店铺存在且与履约模式同平台；仓库存在；仓库类型与履约模式兼容；
 * 托管仓（PLATFORM）只能绑定一个平台仓库；同店铺同平台仓库 ID 唯一。
 * 硬删除（绑定是纯配置行，无下游外键引用，decision 0003 同款）。
 */
@Injectable()
export class WarehousePlatformBindingService {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly storeService: StoreService,
    private readonly operationLog: OperationLogService,
  ) {}

  async list(
    query: { warehouseId?: string; storeId?: string; status?: string } & {
      page: number;
      pageSize: number;
    },
  ): Promise<{ items: PlatformBindingResponseDto[]; meta: PageMeta }> {
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.listPlatformBindingsWithRefs(
      {
        warehouseId: query.warehouseId,
        storeId: query.storeId,
        status: query.status,
      },
      pageSize,
      offsetOf(page, pageSize),
    );
    return { items: rows.map((row) => this.toResponse(row)), meta: { page, pageSize, total } };
  }

  async create(
    warehouseId: string,
    dto: CreatePlatformBindingRequestDto,
    operator: OperatorContext,
  ): Promise<PlatformBindingResponseDto> {
    const warehouse = await this.repository.findWarehouseById(warehouseId);
    if (warehouse === null) {
      throw new WarehouseNotFoundError(warehouseId);
    }
    const storeWithPlatform = await this.storeService.getEntityWithPlatform(dto.storeId);
    if (storeWithPlatform === null) {
      throw new WarehousePlatformBindingInvalidError(`Store not found: ${dto.storeId}`);
    }

    // 平台一致性：WB 店铺 + OZON_FBO 必须拒绝。
    const modePlatform = platformCodeOfFulfillmentMode(dto.fulfillmentMode);
    if (modePlatform !== storeWithPlatform.platformCode) {
      throw new WarehousePlatformBindingInvalidError(
        `履约模式 ${dto.fulfillmentMode} 属于平台 ${modePlatform}，而店铺属于 ${storeWithPlatform.platformCode}`,
        {
          storeId: dto.storeId,
          fulfillmentMode: dto.fulfillmentMode,
          storePlatform: storeWithPlatform.platformCode,
        },
      );
    }

    // 仓库类型 ↔ 履约模式兼容（用户指示：仓库只能绑定对应的履约模式）。
    const allowed = MODE_ALLOWED_WAREHOUSE_TYPES[dto.fulfillmentMode] ?? [];
    if (!allowed.includes(warehouse.warehouseType)) {
      throw new WarehousePlatformBindingInvalidError(
        `履约模式 ${dto.fulfillmentMode} 只允许绑定类型为 ${allowed.join('/')} 的仓库，当前仓库类型为 ${warehouse.warehouseType}`,
        {
          warehouseId: warehouse.id,
          warehouseType: warehouse.warehouseType,
          allowed,
        },
      );
    }

    // 托管仓只能绑定一个平台仓库（用户指示 2026-09-17）。
    if (warehouse.warehouseType === 'PLATFORM') {
      const existing = await this.repository.countPlatformBindingsByWarehouse(warehouse.id);
      if (existing > 0) {
        throw new WarehousePlatformBindingInvalidError(
          '托管仓只能绑定一个平台仓库；请先解除现有绑定',
          { warehouseId: warehouse.id, existingBindings: existing },
        );
      }
    }

    // 同店铺内平台仓库 ID 唯一（一个平台仓库至多映射到一个内部仓库）。
    const duplicate = await this.repository.findPlatformBinding(
      dto.storeId,
      dto.platformWarehouseId,
    );
    if (duplicate !== null) {
      throw new WarehousePlatformBindingInvalidError(
        '该店铺的此平台仓库已绑定到其它（或当前）仓库',
        { existingBindingId: duplicate.id },
      );
    }

    const binding = await this.repository.insertPlatformBinding({
      warehouseId: warehouse.id,
      storeId: dto.storeId,
      platformWarehouseId: dto.platformWarehouseId,
      platformWarehouseName: dto.platformWarehouseName ?? null,
      fulfillmentMode: dto.fulfillmentMode,
      remarkName: dto.remarkName ?? null,
      priority: dto.priority ?? 100,
      status: 'ACTIVE',
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: binding.id,
      entityCode: `${warehouse.warehouseCode}<-${storeWithPlatform.store.storeCode}/${dto.platformWarehouseId}`,
      action: 'CREATE',
      changes: {
        platformWarehouseId: { from: null, to: binding.platformWarehouseId },
        fulfillmentMode: { from: null, to: binding.fulfillmentMode },
      },
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

  async remove(warehouseId: string, bindingId: string, operator: OperatorContext): Promise<void> {
    const row = await this.findOwnedOrThrow(warehouseId, bindingId);
    await this.repository.deletePlatformBinding(bindingId);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: bindingId,
      entityCode: `${row.warehouseCode}<-${row.storeCode}/${row.binding.platformWarehouseId}`,
      action: 'DELETE',
      changes: {
        deleted: { from: row.binding.platformWarehouseId, to: null },
      },
      operator,
    });
  }

  /** 订单摄入等跨模块消费：店铺 → ACTIVE 绑定（priority ASC）。 */
  async listActiveByStore(
    storeId: string,
  ): Promise<Array<{ binding: WarehousePlatformBindingEntity; warehouseType: string }>> {
    const rows = await this.repository.listActiveBindingsForStore(storeId);
    return rows.map((row) => ({
      binding: row.binding,
      warehouseType: row.warehouse.warehouseType,
    }));
  }

  private async findOwnedOrThrow(
    warehouseId: string,
    bindingId: string,
  ): Promise<PlatformBindingRowWithRefs> {
    const binding = await this.repository.findPlatformBindingById(bindingId);
    if (binding === null || binding.warehouseId !== warehouseId) {
      throw new WarehousePlatformBindingNotFoundError(bindingId);
    }
    const rows = await this.repository.listPlatformBindingsWithRefs({ warehouseId }, 1000, 0);
    const row = rows.rows.find((candidate) => candidate.binding.id === bindingId);
    if (row === undefined) {
      throw new WarehousePlatformBindingNotFoundError(bindingId);
    }
    return row;
  }

  private toResponse(row: PlatformBindingRowWithRefs): PlatformBindingResponseDto {
    return {
      id: row.binding.id,
      warehouseId: row.binding.warehouseId,
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
      storeId: row.binding.storeId,
      storeCode: row.storeCode,
      storeName: row.storeName,
      platformCode: row.platformCode,
      platformWarehouseId: row.binding.platformWarehouseId,
      platformWarehouseName: row.binding.platformWarehouseName,
      fulfillmentMode: row.binding.fulfillmentMode,
      remarkName: row.binding.remarkName,
      priority: row.binding.priority,
      status: row.binding.status,
      createdAt: row.binding.createdAt,
      updatedAt: row.binding.updatedAt,
    };
  }
}
