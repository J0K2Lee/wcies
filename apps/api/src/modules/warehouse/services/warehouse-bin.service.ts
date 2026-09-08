import { Injectable } from '@nestjs/common';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { WarehouseBinEntity } from '../entities/warehouse-bin.entity';
import {
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
 * auto-generated as BIN-{warehouseCode}-{binCode} when omitted.
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
      { keyword: query.keyword?.trim() || undefined, status: query.status },
      pageSize,
      offsetOf(page, pageSize),
    );
    return { items: rows.map((bin) => this.toResponse(bin)), meta: { page, pageSize, total } };
  }

  async create(
    warehouseId: string,
    dto: CreateBinRequestDto,
    operator: OperatorContext,
  ): Promise<BinResponseDto> {
    const warehouse = await this.assertWarehouseExists(warehouseId);
    const existing = await this.repository.findBinByCode(warehouseId, dto.binCode);
    if (existing !== null) {
      throw new WarehouseBinAlreadyExistsError(warehouseId, [dto.binCode]);
    }
    const bin = await this.repository.insertBin({
      warehouseId,
      binCode: dto.binCode,
      zone: dto.zone ?? null,
      rack: dto.rack ?? null,
      level: dto.level ?? null,
      position: dto.position ?? null,
      barcode: dto.barcode ?? `BIN-${warehouse.warehouseCode}-${dto.binCode}`,
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
   * Batch creation (task §41): rack A01~A05 x level 01~04 -> SZ01-A01-01 ...
   * Duplicate codes (in-file or already in DB) are rejected with the full
   * conflict list before anything is inserted.
   */
  async batchCreate(
    warehouseId: string,
    dto: BatchCreateBinsRequestDto,
    operator: OperatorContext,
  ): Promise<BatchCreateBinsResponseDto> {
    const warehouse = await this.assertWarehouseExists(warehouseId);

    const racks = expandRange(dto.rackFrom, dto.rackTo, 'rack');
    const levels = expandRange(dto.levelFrom, dto.levelTo, 'level');
    const positions =
      dto.positionFrom !== undefined && dto.positionTo !== undefined
        ? expandRange(dto.positionFrom, dto.positionTo, 'position')
        : null;

    const bins: Array<Partial<WarehouseBinEntity>> = [];
    const seen = new Set<string>();
    for (const rack of racks) {
      for (const level of levels) {
        if (positions === null) {
          bins.push({
            warehouseId,
            binCode: `${warehouse.warehouseCode}-${rack}-${level}`,
            zone: dto.zone ?? null,
            rack,
            level,
            position: null,
          });
        } else {
          for (const position of positions) {
            bins.push({
              warehouseId,
              binCode: `${warehouse.warehouseCode}-${rack}-${level}-${position}`,
              zone: dto.zone ?? null,
              rack,
              level,
              position,
            });
          }
        }
      }
    }

    if (bins.length > MAX_BATCH_BINS) {
      throw new WarehouseBinBatchInvalidError(`Batch exceeds ${MAX_BATCH_BINS} bins`);
    }
    for (const bin of bins) {
      const code = bin.binCode as string;
      if (seen.has(code)) {
        throw new WarehouseBinAlreadyExistsError(warehouseId, [code]);
      }
      seen.add(code);
    }
    const conflicts = await this.repository.findExistingBinCodes(warehouseId, [...seen]);
    if (conflicts.length > 0) {
      throw new WarehouseBinAlreadyExistsError(
        warehouseId,
        conflicts.map((bin) => bin.binCode),
      );
    }

    for (const bin of bins) {
      bin.barcode = `BIN-${bin.binCode}`;
      bin.status = 'ACTIVE';
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
