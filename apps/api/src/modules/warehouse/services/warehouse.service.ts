import { Injectable } from '@nestjs/common';
import { PageMeta } from '@wcies/shared';
import {
  OperatorContext,
  OperationLogService,
  diffOf,
} from '../../operation-log/operation-log.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { WarehouseEntity } from '../entities/warehouse.entity';
import {
  WarehouseCodeAlreadyExistsError,
  WarehouseInUseError,
  WarehouseNotFoundError,
} from '../errors/warehouse-errors';
import { WarehouseRepository, WarehouseRowWithCounts } from '../repositories/warehouse.repository';
import {
  CreateWarehouseRequestDto,
  UpdateWarehouseRequestDto,
  WarehouseListItemDto,
  WarehouseListQueryDto,
  WarehouseResponseDto,
} from '../dto/warehouse.dto';
import { offsetOf } from '../../../common/dto/pagination.dto';

const ENTITY_TYPE = 'WAREHOUSE';

/** Warehouse master data (task §35-§37); disable instead of delete. */
@Injectable()
export class WarehouseService {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly businessCode: BusinessCodeService,
    private readonly operationLog: OperationLogService,
  ) {}

  async list(
    query: WarehouseListQueryDto & { page: number; pageSize: number },
  ): Promise<{ items: WarehouseListItemDto[]; meta: PageMeta }> {
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.listWithCounts(
      {
        keyword: query.keyword?.trim() || undefined,
        warehouseType: query.warehouseType,
        status: query.status,
      },
      pageSize,
      offsetOf(page, pageSize),
    );
    return {
      items: rows.map((row) => this.toListItem(row)),
      meta: { page, pageSize, total },
    };
  }

  async create(
    dto: CreateWarehouseRequestDto,
    operator: OperatorContext,
  ): Promise<WarehouseResponseDto> {
    // Auto-coded per warehouse type scope (ZG/PT/SF/TH-%02d) when omitted
    // (decision #3); the type itself is immutable after creation.
    const manualCode = dto.warehouseCode?.trim();
    if (manualCode !== undefined && manualCode !== '') {
      const existing = await this.repository.findWarehouseByCode(manualCode);
      if (existing !== null) {
        throw new WarehouseCodeAlreadyExistsError(manualCode);
      }
    }
    const warehouseCode =
      manualCode || (await this.businessCode.nextWarehouseCode(dto.warehouseType));
    const warehouse = await this.repository.insertWarehouse({
      warehouseCode,
      name: dto.name,
      warehouseType: dto.warehouseType,
      countryCode: dto.countryCode ?? null,
      province: dto.province ?? null,
      city: dto.city ?? null,
      address: dto.address ?? null,
      contactName: dto.contactName ?? null,
      contactPhone: dto.contactPhone ?? null,
      status: 'ACTIVE',
      remark: dto.remark ?? null,
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: warehouse.id,
      entityCode: warehouse.warehouseCode,
      action: 'CREATE',
      changes: {
        warehouseCode: { from: null, to: warehouse.warehouseCode },
        warehouseType: { from: null, to: warehouse.warehouseType },
      },
      operator,
    });
    return this.toResponse(warehouse);
  }

  async getById(id: string): Promise<WarehouseResponseDto> {
    return this.toResponse(await this.findOrThrow(id));
  }

  async update(
    id: string,
    dto: UpdateWarehouseRequestDto,
    operator: OperatorContext,
  ): Promise<WarehouseResponseDto> {
    const existing = await this.findOrThrow(id);
    const before = this.snapshot(existing);
    const patch: Partial<WarehouseEntity> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.countryCode !== undefined) patch.countryCode = dto.countryCode;
    if (dto.province !== undefined) patch.province = dto.province;
    if (dto.city !== undefined) patch.city = dto.city;
    if (dto.address !== undefined) patch.address = dto.address;
    if (dto.contactName !== undefined) patch.contactName = dto.contactName;
    if (dto.contactPhone !== undefined) patch.contactPhone = dto.contactPhone;
    if (dto.remark !== undefined) patch.remark = dto.remark;

    if (Object.keys(patch).length > 0) {
      await this.repository.updateWarehouse(id, patch);
    }
    const updated = await this.findOrThrow(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: updated.warehouseCode,
      action: 'UPDATE',
      changes: diffOf(before, this.snapshot(updated)),
      operator,
    });
    return this.toResponse(updated);
  }

  async setStatus(
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    operator: OperatorContext,
  ): Promise<WarehouseResponseDto> {
    const existing = await this.findOrThrow(id);
    await this.repository.updateWarehouse(id, { status });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.warehouseCode,
      action: status === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE',
      changes: { status: { from: existing.status, to: status } },
      operator,
    });
    return this.toResponse(await this.findOrThrow(id));
  }

  /** Zero-reference hard delete (decision 0003); referenced -> WAREHOUSE_IN_USE. */
  async remove(id: string, operator: OperatorContext): Promise<void> {
    const existing = await this.findOrThrow(id);
    const references = await this.repository.countWarehouseReferences(id);
    const used = references.filter((reference) => reference.count > 0);
    if (used.length > 0) {
      throw new WarehouseInUseError(used.map((reference) => reference.table));
    }
    await this.repository.deleteWarehouse(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.warehouseCode,
      action: 'DELETE',
      changes: { deleted: { from: existing.warehouseCode, to: null } },
      operator,
    });
  }

  /** Cross-module lookups (binding / import services). */
  async getEntityById(id: string): Promise<WarehouseEntity | null> {
    return this.repository.findWarehouseById(id);
  }

  async getEntityByCode(code: string): Promise<WarehouseEntity | null> {
    return this.repository.findWarehouseByCode(code);
  }

  private async findOrThrow(id: string): Promise<WarehouseEntity> {
    const warehouse = await this.repository.findWarehouseById(id);
    if (warehouse === null) {
      throw new WarehouseNotFoundError(id);
    }
    return warehouse;
  }

  private snapshot(warehouse: WarehouseEntity): Record<string, unknown> {
    return {
      name: warehouse.name,
      countryCode: warehouse.countryCode,
      province: warehouse.province,
      city: warehouse.city,
      address: warehouse.address,
      contactName: warehouse.contactName,
      contactPhone: warehouse.contactPhone,
      remark: warehouse.remark,
    };
  }

  private toListItem(row: WarehouseRowWithCounts): WarehouseListItemDto {
    return {
      ...this.toResponse(row.warehouse),
      binCount: row.binCount,
      boundPlatformWarehouseCount: row.boundPlatformWarehouseCount,
    };
  }

  private toResponse(warehouse: WarehouseEntity): WarehouseResponseDto {
    return {
      id: warehouse.id,
      warehouseCode: warehouse.warehouseCode,
      name: warehouse.name,
      warehouseType: warehouse.warehouseType,
      countryCode: warehouse.countryCode,
      province: warehouse.province,
      city: warehouse.city,
      address: warehouse.address,
      contactName: warehouse.contactName,
      contactPhone: warehouse.contactPhone,
      status: warehouse.status,
      remark: warehouse.remark,
      createdAt: warehouse.createdAt,
      updatedAt: warehouse.updatedAt,
    };
  }
}
