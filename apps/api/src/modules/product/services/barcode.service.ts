import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { SkuBarcodeEntity } from '../entities/sku-barcode.entity';
import { BarcodeAlreadyExistsError, BarcodeNotFoundError } from '../errors/barcode-errors';
import { SkuNotFoundError } from '../errors/sku-errors';
import { SkuRepository } from '../repositories/sku.repository';
import { SkuBarcodeRepository } from '../repositories/sku-barcode.repository';
import {
  BarcodeResolveDto,
  BarcodeResponseDto,
  CreateBarcodeRequestDto,
  UpdateBarcodeRequestDto,
} from '../dto/barcode-image.dto';

const ENTITY_TYPE = 'SKU_BARCODE';

/**
 * SKU barcodes (task §28-§32).
 * - barcode is globally unique (one barcode never binds two SKUs);
 * - at most one is_primary per SKU (DB partial unique index);
 * - INTERNAL barcodes (WCSKU%08d) can be generated when no vendor code exists.
 */
@Injectable()
export class BarcodeService {
  constructor(
    private readonly repository: SkuBarcodeRepository,
    private readonly skuRepository: SkuRepository,
    private readonly operationLog: OperationLogService,
  ) {}

  async listBySku(skuId: string): Promise<BarcodeResponseDto[]> {
    await this.assertSkuExists(skuId);
    const barcodes = await this.repository.listBySkuId(skuId);
    return barcodes.map((barcode) => this.toResponse(barcode));
  }

  async create(
    skuId: string,
    dto: CreateBarcodeRequestDto,
    operator: OperatorContext,
  ): Promise<BarcodeResponseDto> {
    await this.assertSkuExists(skuId);
    const existing = await this.repository.findByBarcode(dto.barcode);
    if (existing !== null) {
      throw new BarcodeAlreadyExistsError(dto.barcode);
    }

    const existingPrimary = await this.repository.findPrimaryOfSku(skuId);
    const isPrimary = dto.isPrimary ?? existingPrimary === null;

    const barcode = await this.repository.insertWithPrimaryHandling({
      skuId,
      barcode: dto.barcode,
      barcodeType: dto.barcodeType,
      isPrimary,
      status: 'ACTIVE',
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: barcode.id,
      entityCode: barcode.barcode,
      action: 'CREATE',
      changes: {
        barcode: { from: null, to: barcode.barcode },
        barcodeType: { from: null, to: barcode.barcodeType },
        isPrimary: { from: null, to: barcode.isPrimary },
      },
      operator,
    });
    return this.toResponse(barcode);
  }

  /** Generates an INTERNAL barcode (WCSKU%08d) for the SKU (task §32). */
  async generateInternal(skuId: string, operator: OperatorContext): Promise<BarcodeResponseDto> {
    await this.assertSkuExists(skuId);
    const barcodeValue = await this.repository.nextInternalBarcode();
    return this.create(skuId, { barcode: barcodeValue, barcodeType: 'INTERNAL' }, operator);
  }

  /**
   * Cross-module tx participant (Sprint 8 T1): same generation as
   * generateInternal() but on the CALLER's transaction. The sequence itself
   * (nextval) is non-transactional by design - a rollback may skip a WCSKU
   * number, which is acceptable (internal barcodes have no density contract).
   * Logging stays with the caller (after commit). Returns the raw entity.
   */
  async generateInternalInTx(manager: EntityManager, skuId: string): Promise<SkuBarcodeEntity> {
    const result = await manager.query<Array<{ nextval: string }>>(
      "SELECT nextval('seq_internal_barcode') AS nextval",
    );
    const value = Number(result[0]?.nextval ?? 1);
    const barcodeValue = `WCSKU${String(value).padStart(8, '0')}`;
    const barcodeRepository = manager.getRepository(SkuBarcodeEntity);
    const existing = await barcodeRepository.findOneBy({ barcode: barcodeValue });
    if (existing !== null) {
      throw new BarcodeAlreadyExistsError(barcodeValue);
    }
    // First barcode of the SKU becomes primary - same rule as create().
    const hasAnyBarcode = await barcodeRepository.findOneBy({ skuId });
    const created = barcodeRepository.create({
      skuId,
      barcode: barcodeValue,
      barcodeType: 'INTERNAL',
      isPrimary: hasAnyBarcode === null,
      status: 'ACTIVE',
    });
    return barcodeRepository.save(created);
  }

  async update(
    skuId: string,
    barcodeId: string,
    dto: UpdateBarcodeRequestDto,
    operator: OperatorContext,
  ): Promise<BarcodeResponseDto> {
    const barcode = await this.findOwnedOrThrow(skuId, barcodeId);
    await this.repository.updateWithPrimaryHandling(barcodeId, skuId, {
      barcodeType: dto.barcodeType,
      isPrimary: dto.isPrimary,
      status: dto.status,
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: barcodeId,
      entityCode: barcode.barcode,
      action: 'UPDATE',
      changes: {
        barcodeType: { from: barcode.barcodeType, to: dto.barcodeType ?? barcode.barcodeType },
        isPrimary: { from: barcode.isPrimary, to: dto.isPrimary ?? barcode.isPrimary },
        status: { from: barcode.status, to: dto.status ?? barcode.status },
      },
      operator,
    });
    const updated = await this.repository.findById(barcodeId);
    return this.toResponse(updated as SkuBarcodeEntity);
  }

  /**
   * Hard delete is allowed only because barcodes have no business history in
   * Sprint 1 (spec §57); this tightens once scanning goes live.
   */
  async delete(skuId: string, barcodeId: string, operator: OperatorContext): Promise<void> {
    const barcode = await this.findOwnedOrThrow(skuId, barcodeId);
    await this.repository.deleteById(barcodeId);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: barcodeId,
      entityCode: barcode.barcode,
      action: 'DELETE',
      changes: { barcode: { from: barcode.barcode, to: null } },
      operator,
    });
  }

  /** Cross-module lookups. */
  async findByBarcode(barcode: string): Promise<SkuBarcodeEntity | null> {
    return this.repository.findByBarcode(barcode);
  }

  /**
   * Barcode -> internal SKU with display fields (Sprint 7 T5.1). Returns
   * null when the barcode is unknown or its record is not ACTIVE. Barcodes
   * are globally unique, so there is no store dimension here (unlike the
   * store-scoped Listing Resolver, AGENTS.md par26).
   */
  async resolveBarcode(barcode: string): Promise<BarcodeResolveDto | null> {
    const record = await this.repository.findByBarcode(barcode);
    if (record === null || record.status !== 'ACTIVE') {
      return null;
    }
    const sku = await this.skuRepository.findById(record.skuId);
    if (sku === null) {
      return null;
    }
    return {
      skuId: sku.id,
      skuCode: sku.skuCode,
      skuName: sku.nameZh,
      matchedBarcode: record.barcode,
      barcodeType: record.barcodeType,
      serialTracking: sku.serialTracking,
    };
  }

  private async assertSkuExists(skuId: string): Promise<void> {
    const sku = await this.skuRepository.findById(skuId);
    if (sku === null) {
      throw new SkuNotFoundError(skuId);
    }
  }

  private async findOwnedOrThrow(skuId: string, barcodeId: string): Promise<SkuBarcodeEntity> {
    await this.assertSkuExists(skuId);
    const barcode = await this.repository.findById(barcodeId);
    if (barcode === null || barcode.skuId !== skuId) {
      throw new BarcodeNotFoundError(barcodeId);
    }
    return barcode;
  }

  private toResponse(barcode: SkuBarcodeEntity): BarcodeResponseDto {
    return {
      id: barcode.id,
      skuId: barcode.skuId,
      barcode: barcode.barcode,
      barcodeType: barcode.barcodeType,
      isPrimary: barcode.isPrimary,
      status: barcode.status,
      createdAt: barcode.createdAt,
    };
  }
}
