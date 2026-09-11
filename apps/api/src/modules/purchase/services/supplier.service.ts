import { Injectable } from '@nestjs/common';
import { PageMeta } from '@wcies/shared';
import {
  OperatorContext,
  OperationLogService,
  diffOf,
} from '../../operation-log/operation-log.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { SupplierEntity } from '../entities/supplier.entity';
import {
  SupplierCodeAlreadyExistsError,
  SupplierInUseError,
  SupplierNotFoundError,
} from '../errors/purchase-errors';
import { SupplierRepository } from '../repositories/supplier.repository';
import {
  CreateSupplierRequestDto,
  SupplierListItemDto,
  SupplierListQueryDto,
  SupplierResponseDto,
  UpdateSupplierRequestDto,
} from '../dto/supplier.dto';
import { offsetOf } from '../../../common/dto/pagination.dto';

const ENTITY_TYPE = 'SUPPLIER';

/**
 * Supplier master data (Sprint 7 task §9). Optional on documents: one-off
 * online purchases never become suppliers (decision 0013 §3).
 */
@Injectable()
export class SupplierService {
  constructor(
    private readonly repository: SupplierRepository,
    private readonly businessCode: BusinessCodeService,
    private readonly operationLog: OperationLogService,
  ) {}

  async list(
    query: SupplierListQueryDto & { page: number; pageSize: number },
  ): Promise<{ items: SupplierListItemDto[]; meta: PageMeta }> {
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.list(
      { keyword: query.keyword?.trim() || undefined, status: query.status },
      pageSize,
      offsetOf(page, pageSize),
    );
    return {
      // Referencing tables arrive with T3/T4; until then every count is 0.
      items: rows.map((supplier) => ({ ...this.toResponse(supplier), referenceCount: 0 })),
      meta: { page, pageSize, total },
    };
  }

  async create(
    dto: CreateSupplierRequestDto,
    operator: OperatorContext,
  ): Promise<SupplierResponseDto> {
    const manualCode = dto.code?.trim();
    if (manualCode !== undefined && manualCode !== '') {
      if ((await this.repository.findByCode(manualCode)) !== null) {
        throw new SupplierCodeAlreadyExistsError(manualCode);
      }
    }
    const code = manualCode || (await this.businessCode.nextSupplierCode());
    const supplier = await this.repository.insert({
      code,
      name: dto.name,
      contactName: dto.contactName ?? null,
      contactPhone: dto.contactPhone ?? null,
      status: 'ACTIVE',
      remark: dto.remark ?? null,
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: supplier.id,
      entityCode: supplier.code,
      action: 'CREATE',
      changes: { code: { from: null, to: supplier.code }, name: { from: null, to: supplier.name } },
      operator,
    });
    return this.toResponse(supplier);
  }

  async getById(id: string): Promise<SupplierResponseDto> {
    return this.toResponse(await this.findOrThrow(id));
  }

  async update(
    id: string,
    dto: UpdateSupplierRequestDto,
    operator: OperatorContext,
  ): Promise<SupplierResponseDto> {
    const existing = await this.findOrThrow(id);
    const before = this.snapshot(existing);
    const patch: Partial<SupplierEntity> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.contactName !== undefined) patch.contactName = dto.contactName;
    if (dto.contactPhone !== undefined) patch.contactPhone = dto.contactPhone;
    if (dto.remark !== undefined) patch.remark = dto.remark;
    if (Object.keys(patch).length > 0) {
      await this.repository.update(id, patch);
    }
    const updated = await this.findOrThrow(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: updated.code,
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
  ): Promise<SupplierResponseDto> {
    const existing = await this.findOrThrow(id);
    await this.repository.update(id, { status });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.code,
      action: status === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE',
      changes: { status: { from: existing.status, to: status } },
      operator,
    });
    return this.toResponse(await this.findOrThrow(id));
  }

  /** Zero-reference hard delete (decision 0003); referenced -> SUPPLIER_IN_USE. */
  async remove(id: string, operator: OperatorContext): Promise<void> {
    const existing = await this.findOrThrow(id);
    const references = await this.repository.countReferences(id);
    const used = references.filter((reference) => reference.count > 0);
    if (used.length > 0) {
      throw new SupplierInUseError(used.map((reference) => reference.table));
    }
    await this.repository.delete(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.code,
      action: 'DELETE',
      changes: { deleted: { from: existing.code, to: null } },
      operator,
    });
  }

  /** Cross-module lookups. */
  async getEntityById(id: string): Promise<SupplierEntity | null> {
    return this.repository.findById(id);
  }

  private async findOrThrow(id: string): Promise<SupplierEntity> {
    const supplier = await this.repository.findById(id);
    if (supplier === null) {
      throw new SupplierNotFoundError(id);
    }
    return supplier;
  }

  private snapshot(supplier: SupplierEntity): Record<string, unknown> {
    return {
      name: supplier.name,
      contactName: supplier.contactName,
      contactPhone: supplier.contactPhone,
      status: supplier.status,
      remark: supplier.remark,
    };
  }

  private toResponse(supplier: SupplierEntity): SupplierResponseDto {
    return {
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      contactName: supplier.contactName,
      contactPhone: supplier.contactPhone,
      status: supplier.status,
      remark: supplier.remark,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
    };
  }
}
