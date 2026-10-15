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
  BatchDeleteBinFailureDto,
  BatchDeleteBinsResponseDto,
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
 * The one canonical bin code format, shared by every creation path:
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
 * Rack label for a zone + rack number: zone 'A', number 3 -> 'A03'.
 *
 * `width` is the zero-pad width, defaulting to the 2-digit minimum. A batch
 * passes the width of its LARGEST rack so every code in that batch has the
 * same width - mixing widths would break the lexical order that allocation
 * and picking rely on (B99 sorts after B100 when padded inconsistently).
 */
export function formatRack(zone: string | null, rackNumber: number, width = 2): string {
  return `${zone ?? ''}${String(rackNumber).padStart(Math.max(2, width), '0')}`;
}

/**
 * Drops leading zeros from a purely numeric segment, so `01` and `1` cannot
 * become two different codes for the same physical level. Non-numeric input
 * (imported free-form segments) is kept as-is.
 */
export function normalizeSegment(value: string | undefined | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    return null;
  }
  return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed;
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
    const zone = dto.zone?.trim() || null;

    // Two shapes reach here, and they differ in who owns the code:
    //  - explicit `binCode` (Excel import): the caller owns the string, so the
    //    descriptive columns are stored exactly as given.
    //  - layout intent (create dialog): the server generates the code through
    //    the same helpers the batch path uses, so a code can never be
    //    hand-authored into a shape the batch path would not produce.
    let binCode: string;
    let rack: string | null;
    let level: string | null;
    let position: string | null;

    if (dto.binCode !== undefined) {
      binCode = dto.binCode.trim();
      rack = dto.rack?.trim() || null;
      level = dto.level?.trim() || null;
      position = dto.position?.trim() || null;
    } else {
      rack = dto.rackNumber !== undefined ? formatRack(zone, dto.rackNumber) : null;
      level = normalizeSegment(dto.level);
      position = normalizeSegment(dto.position);
      if (rack === null || level === null) {
        throw new WarehouseBinBatchInvalidError(
          'Provide binCode, or enough to generate one (rackNumber and level)',
        );
      }
      binCode = formatBinCode(warehouse.warehouseCode, rack, level, position);
    }

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
      zone,
      rack,
      level,
      position,
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
      // Same helper as single create, so both paths cannot drift apart; the
      // batch supplies its uniform width to keep codes comparable.
      const rack = formatRack(zoneOrNull, Number(rackNumber), rackWidth);
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

  /**
   * 批量删除（用户指示 2026-09-28）：逐个执行与单删完全相同的零引用规则
   * ——被引用/不存在/不属于该仓库的库位跳过并逐条返回原因，**部分成功**，
   * 绝不整批回滚（一条被引用不阻塞其余清理）。每个成功删除的库位照常
   * 写独立的 DELETE 操作日志；最后写一条 BATCH_DELETE 汇总。
   */
  async batchRemove(
    warehouseId: string,
    binIds: readonly string[],
    operator: OperatorContext,
  ): Promise<BatchDeleteBinsResponseDto> {
    const warehouse = await this.assertWarehouseExists(warehouseId);
    const unique = [...new Set(binIds)];
    if (unique.length > MAX_BATCH_BINS) {
      throw new WarehouseBinBatchInvalidError(
        `Batch would delete ${unique.length} bins, exceeding the ${MAX_BATCH_BINS} limit`,
      );
    }

    const failures: BatchDeleteBinFailureDto[] = [];
    let deletedCount = 0;
    for (const binId of unique) {
      const bin = await this.repository.findBinById(binId);
      if (bin === null || bin.warehouseId !== warehouseId) {
        failures.push({ binId, binCode: bin?.binCode ?? null, reason: '库位不存在或不属于该仓库' });
        continue;
      }
      const references = await this.repository.countBinReferences(binId);
      const used = references.filter((reference) => reference.count > 0);
      if (used.length > 0) {
        failures.push({
          binId,
          binCode: bin.binCode,
          reason: `该库位已被引用（${used.map((reference) => reference.table).join('、')}），只能停用不能删除`,
        });
        continue;
      }
      await this.repository.deleteBin(binId);
      deletedCount += 1;
      await this.operationLog.record({
        entityType: ENTITY_TYPE,
        entityId: binId,
        entityCode: bin.binCode,
        action: 'DELETE',
        changes: { deleted: { from: bin.binCode, to: null } },
        operator,
      });
    }

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: warehouseId,
      entityCode: warehouse.warehouseCode,
      action: 'BATCH_DELETE',
      changes: {
        deletedCount: { from: null, to: deletedCount },
        failedCount: { from: null, to: failures.length },
      },
      operator,
    });

    return { deletedCount, failures };
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

  /**
   * Interception fallback bin (Sprint 9 T3, decision 4 = A): when a
   * cancelled-picked item must return to stock and no target bin was scanned,
   * the warehouse may simply have NO staging location yet - auto-creating one
   * `STAGING` bin must never block the physical recovery flow. Idempotent:
   * returns the existing STAGING bin when present. Creation goes through
   * create(), so the operation log records it.
   */
  async ensureStagingBin(
    warehouseId: string,
    operator: OperatorContext,
  ): Promise<WarehouseBinEntity> {
    const existing = await this.repository.findBinByCode(warehouseId, 'STAGING');
    if (existing !== null) {
      return existing;
    }
    const created = await this.create(
      warehouseId,
      { binCode: 'STAGING', remark: '拦截暂存位（系统自动创建，Sprint 9 决策 4）' },
      operator,
    );
    return (await this.repository.findBinById(created.id)) as WarehouseBinEntity;
  }

  /**
   * Receiving default staging bin (2026-10-15, 决策 0021): the receiving flow
   * defaults a line to the SKU's current bin, and to a staging location when
   * the SKU has no stock in that warehouse yet. Uses the same `ST` zone the
   * receiving page's manual "创建暂存库位（ST 区）" button produces
   * (rack 1 / level 1), so an auto-created bin is indistinguishable from a
   * hand-created one. Idempotent: returns the first `ST` bin when present.
   */
  async ensureReceiptStagingBin(
    warehouseId: string,
    operator: OperatorContext,
  ): Promise<WarehouseBinEntity> {
    const existing = await this.repository.findFirstBinByZone(warehouseId, 'ST');
    if (existing !== null) {
      return existing;
    }
    const created = await this.create(
      warehouseId,
      { zone: 'ST', rackNumber: 1, level: '1', remark: '收货暂存位（系统自动创建，决策 0021）' },
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
