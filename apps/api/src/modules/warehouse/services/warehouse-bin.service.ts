import { Injectable } from '@nestjs/common';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { WarehouseBinEntity } from '../entities/warehouse-bin.entity';
import {
  BinInUseError,
  WarehouseBinAlreadyExistsError,
  WarehouseBinBatchInvalidError,
  WarehouseBinNotFoundError,
  WarehouseNotFoundError,
} from '../errors/warehouse-errors';
import { WarehouseRepository } from '../repositories/warehouse.repository';
import {
  BatchCreateBinsRequestDto,
  BatchCreateBinsResponseDto,
  BinListQueryDto,
  BinResponseDto,
  CreateBinRequestDto,
  UpdateBinRequestDto,
} from '../dto/warehouse.dto';
import { offsetOf } from '../../../common/dto/pagination.dto';

const ENTITY_TYPE = 'WAREHOUSE_BIN';
const MAX_BATCH_BINS = 2000;
/** warehouse_bins.bin_code is VARCHAR(100); fail with a domain error, not a DB one. */
const BIN_CODE_MAX_LENGTH = 100;

/**
 * The one canonical bin code format, shared by both creation paths:
 *
 *   {warehouseCode}-{rack}-{level}[-{position}]   e.g. ZG-01-A05-1
 *
 * The warehouse code is part of the string so a printed label identifies its
 * warehouse on sight; `warehouse_bins` is only unique per warehouse, so the
 * prefix also keeps the label globally unambiguous. The same string is stored
 * in `bin_code` AND `barcode`, because bins are resolved by `bin_code` when
 * scanned - one value means a scanned label always resolves.
 */
export function formatBinCode(
  warehouseCode: string,
  rack: string,
  level: string,
  position?: string | null,
): string {
  const base = `${warehouseCode}-${rack}-${level}`;
  return position === undefined || position === null || position === ''
    ? base
    : `${base}-${position}`;
}

/**
 * Expands an inclusive alphanumeric range like A01..A05 / 01..04.
 * The non-numeric prefix must match; numbers keep the original zero padding.
 */
export function expandRange(from: string, to: string, label: string): string[] {
  const fromMatch = /^(.*?)(\d+)$/.exec(from);
  const toMatch = /^(.*?)(\d+)$/.exec(to);
  if (fromMatch === null || toMatch === null) {
    throw new WarehouseBinBatchInvalidError(`${label} values must end with digits: ${from}..${to}`);
  }
  const fromPrefix = fromMatch[1] ?? '';
  const toPrefix = toMatch[1] ?? '';
  if (fromPrefix !== toPrefix) {
    throw new WarehouseBinBatchInvalidError(`${label} prefixes must match: ${from} vs ${to}`);
  }
  const fromNum = Number(fromMatch[2]);
  const toNum = Number(toMatch[2]);
  const width = (fromMatch[2] ?? '').length;
  if (fromNum > toNum) {
    throw new WarehouseBinBatchInvalidError(`${label} range is reversed: ${from}..${to}`);
  }
  if (toNum - fromNum + 1 > MAX_BATCH_BINS) {
    throw new WarehouseBinBatchInvalidError(`${label} range too large (max ${MAX_BATCH_BINS})`);
  }
  const values: string[] = [];
  for (let i = fromNum; i <= toNum; i += 1) {
    values.push(fromPrefix + String(i).padStart(width, '0'));
  }
  return values;
}

/**
 * Warehouse bins (task §38-§41). bin_code is unique per warehouse only, so
 * the same code may exist in different warehouses. Barcodes are
 * default: barcode = bin_code, so a scanned label always resolves.
 */
@Injectable()
export class WarehouseBinService {
  constructor(
    private readonly repository: WarehouseRepository,
    private readonly operationLog: OperationLogService,
  ) {}

  async list(
    warehouseId: string,
    query: BinListQueryDto & { page: number; pageSize: number },
  ): Promise<{ items: BinResponseDto[]; meta: PageMeta }> {
    await this.assertWarehouseExists(warehouseId);
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.listBins(
      warehouseId,
      {
        keyword: query.keyword?.trim() || undefined,
        zone: query.zone?.trim() || undefined,
        status: query.status,
      },
      pageSize,
      offsetOf(page, pageSize),
    );
    return { items: rows.map((bin) => this.toResponse(bin)), meta: { page, pageSize, total } };
  }

  /** Zones present in a warehouse; feeds the zone filter dropdown. */
  async listZones(warehouseId: string): Promise<string[]> {
    await this.assertWarehouseExists(warehouseId);
    return this.repository.listBinZones(warehouseId);
  }

  async create(
    warehouseId: string,
    dto: CreateBinRequestDto,
    operator: OperatorContext,
  ): Promise<BinResponseDto> {
    const warehouse = await this.assertWarehouseExists(warehouseId);
    const binCode =
      dto.binCode ??
      formatBinCode(warehouse.warehouseCode, dto.rack ?? '', dto.level ?? '', dto.position);
    if (binCode.length > BIN_CODE_MAX_LENGTH) {
      throw new WarehouseBinBatchInvalidError(
        `Bin code exceeds ${BIN_CODE_MAX_LENGTH} characters: ${binCode}`,
      );
    }
    const existing = await this.repository.findBinByCode(warehouseId, binCode);
    if (existing !== null) {
      throw new WarehouseBinAlreadyExistsError(warehouseId, [binCode]);
    }
    const bin = await this.repository.insertBin({
      warehouseId,
      binCode,
      zone: dto.zone ?? null,
      rack: dto.rack ?? null,
      level: dto.level ?? null,
      position: dto.position ?? null,
      // One value: the barcode IS the code, so a scan always resolves.
      barcode: dto.barcode ?? binCode,
      status: 'ACTIVE',
      remark: dto.remark ?? null,
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: bin.id,
      entityCode: `${warehouse.warehouseCode}/${bin.binCode}`,
      action: 'CREATE',
      changes: { binCode: { from: null, to: bin.binCode } },
      operator,
    });
    return this.toResponse(bin);
  }

  /**
   * Batch creation (task §41, revised 2026-09-11): the caller states the
   * layout intent and this service owns the bin_code format, because bin_code
   * is immutable and printed on physical labels.
   *
   *   zone 'A', rackStart 1, rackCount 5, levelsPerRack 4
   *     -> ZG-01-A01-1 … ZG-01-A05-4 (20 bins)
   *
   * Rack numbers are zero-padded to at least two digits so lexical order
   * matches physical walking order; levels stay unpadded (`A05-1`). Duplicate
   * codes (in-file or already in DB) are rejected with the full conflict list
   * before anything is inserted.
   */
  async batchCreate(
    warehouseId: string,
    dto: BatchCreateBinsRequestDto,
    operator: OperatorContext,
  ): Promise<BatchCreateBinsResponseDto> {
    const warehouse = await this.assertWarehouseExists(warehouseId);

    const total = dto.rackCount * dto.levelsPerRack;
    if (total > MAX_BATCH_BINS) {
      throw new WarehouseBinBatchInvalidError(
        `Batch would create ${total} bins, exceeding the ${MAX_BATCH_BINS} limit`,
      );
    }

    const zone = dto.zone?.trim() ?? '';
    const zoneOrNull = zone === '' ? null : zone;
    const lastRack = dto.rackStart + dto.rackCount - 1;
    const rackWidth = Math.max(2, String(lastRack).length);
    const rackNumbers = expandRange(
      String(dto.rackStart).padStart(rackWidth, '0'),
      String(lastRack).padStart(rackWidth, '0'),
      'rack',
    );
    const levels = expandRange('1', String(dto.levelsPerRack), 'level');

    const bins: Array<Partial<WarehouseBinEntity>> = [];
    for (const rackNumber of rackNumbers) {
      const rack = `${zone}${rackNumber}`;
      for (const level of levels) {
        const binCode = formatBinCode(warehouse.warehouseCode, rack, level);
        if (binCode.length > BIN_CODE_MAX_LENGTH) {
          throw new WarehouseBinBatchInvalidError(
            `Generated bin code exceeds ${BIN_CODE_MAX_LENGTH} characters: ${binCode}`,
          );
        }
        bins.push({
          warehouseId,
          binCode,
          zone: zoneOrNull,
          rack,
          level,
          position: null,
          // The barcode is the printed form of the code: one string, so a
          // scanned label always resolves (bins are looked up by bin_code).
          barcode: binCode,
          status: 'ACTIVE',
        });
      }
    }

    const conflicts = await this.repository.findExistingBinCodes(
      warehouseId,
      bins.map((bin) => bin.binCode as string),
    );
    if (conflicts.length > 0) {
      throw new WarehouseBinAlreadyExistsError(
        warehouseId,
        conflicts.map((bin) => bin.binCode),
      );
    }

    await this.repository.insertBins(bins);

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: warehouseId,
      entityCode: warehouse.warehouseCode,
      action: 'BATCH_CREATE',
      changes: { createdCount: { from: null, to: bins.length } },
      operator,
    });

    return {
      createdCount: bins.length,
      bins: bins.map((bin) => this.toResponse(bin as WarehouseBinEntity)),
    };
  }

  async update(
    warehouseId: string,
    binId: string,
    dto: UpdateBinRequestDto,
    operator: OperatorContext,
  ): Promise<BinResponseDto> {
    const bin = await this.findOwnedOrThrow(warehouseId, binId);
    const patch: Partial<WarehouseBinEntity> = {};
    if (dto.zone !== undefined) patch.zone = dto.zone;
    if (dto.rack !== undefined) patch.rack = dto.rack;
    if (dto.level !== undefined) patch.level = dto.level;
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.barcode !== undefined) patch.barcode = dto.barcode;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.remark !== undefined) patch.remark = dto.remark;
    if (Object.keys(patch).length > 0) {
      await this.repository.updateBin(binId, patch);
    }
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: binId,
      entityCode: bin.binCode,
      action: 'UPDATE',
      changes: { updated: { from: null, to: Object.keys(patch) } },
      operator,
    });
    return this.toResponse((await this.repository.findBinById(binId)) as WarehouseBinEntity);
  }

  async setStatus(
    warehouseId: string,
    binId: string,
    status: 'ACTIVE' | 'INACTIVE',
    operator: OperatorContext,
  ): Promise<BinResponseDto> {
    const bin = await this.findOwnedOrThrow(warehouseId, binId);
    await this.repository.updateBin(binId, { status });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: binId,
      entityCode: bin.binCode,
      action: status === 'ACTIVE' ? 'ENABLE' : 'DISABLE',
      changes: { status: { from: bin.status, to: status } },
      operator,
    });
    return this.toResponse((await this.repository.findBinById(binId)) as WarehouseBinEntity);
  }

  /** Cross-module lookups. */
  async getEntityById(id: string): Promise<WarehouseBinEntity | null> {
    return this.repository.findBinById(id);
  }

  /** Zero-reference hard delete (decision 0003); referenced -> BIN_IN_USE. */
  async remove(warehouseId: string, binId: string, operator: OperatorContext): Promise<void> {
    const bin = await this.findOwnedOrThrow(warehouseId, binId);
    const references = await this.repository.countBinReferences(binId);
    const used = references.filter((reference) => reference.count > 0);
    if (used.length > 0) {
      throw new BinInUseError(used.map((reference) => reference.table));
    }
    await this.repository.deleteBin(binId);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: binId,
      entityCode: bin.binCode,
      action: 'DELETE',
      changes: { deleted: { from: bin.binCode, to: null } },
      operator,
    });
  }

  /** Import handler lookup: existing bin by warehouse + code. */
  async findByWarehouseAndCode(
    warehouseId: string,
    binCode: string,
  ): Promise<WarehouseBinEntity | null> {
    return this.repository.findBinByCode(warehouseId, binCode);
  }

  /** Inventory core lookup: how many bins a warehouse currently has. */
  async countByWarehouse(warehouseId: string): Promise<number> {
    return this.repository.countBins(warehouseId);
  }

  /**
   * Inventory core (Sprint 2 task §6): warehouses that start holding stock
   * without physical bin management get one virtual `DEFAULT` bin, so
   * inventory_balances.bin_id is never NULL and the unique dimension stays
   * stable. Returns the DEFAULT bin when it already exists.
   */
  async ensureDefaultBin(
    warehouseId: string,
    operator: OperatorContext,
  ): Promise<WarehouseBinEntity> {
    const existing = await this.repository.findBinByCode(warehouseId, 'DEFAULT');
    if (existing !== null) {
      return existing;
    }
    const created = await this.create(
      warehouseId,
      { binCode: 'DEFAULT', remark: '系统虚拟库位（无实体库位管理仓默认）' },
      operator,
    );
    return (await this.repository.findBinById(created.id)) as WarehouseBinEntity;
  }

  private async assertWarehouseExists(
    warehouseId: string,
  ): Promise<{ id: string; warehouseCode: string }> {
    const warehouse = await this.repository.findWarehouseById(warehouseId);
    if (warehouse === null) {
      throw new WarehouseNotFoundError(warehouseId);
    }
    return { id: warehouse.id, warehouseCode: warehouse.warehouseCode };
  }

  private async findOwnedOrThrow(warehouseId: string, binId: string): Promise<WarehouseBinEntity> {
    await this.assertWarehouseExists(warehouseId);
    const bin = await this.repository.findBinById(binId);
    if (bin === null || bin.warehouseId !== warehouseId) {
      throw new WarehouseBinNotFoundError(binId);
    }
    return bin;
  }

  private toResponse(bin: WarehouseBinEntity): BinResponseDto {
    return {
      id: bin.id,
      warehouseId: bin.warehouseId,
      binCode: bin.binCode,
      zone: bin.zone,
      rack: bin.rack,
      level: bin.level,
      position: bin.position,
      barcode: bin.barcode,
      status: bin.status,
      remark: bin.remark,
      createdAt: bin.createdAt,
      updatedAt: bin.updatedAt,
    };
  }
}
