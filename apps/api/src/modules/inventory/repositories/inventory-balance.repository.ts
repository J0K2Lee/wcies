import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { InventoryBalanceEntity } from '../entities/inventory-balance.entity';
import { InventoryCondition } from '../enums/inventory.constants';
import { rawStr } from '../../../common/utils/raw';

interface BalanceDim {
  skuId: string;
  warehouseId: string;
  binId: string;
  condition: InventoryCondition;
}

/**
 * Data access for inventory balances (AGENTS.md §8: queries / row locks /
 * saves only - business rules live in services).
 *
 * Locking contract (task §27/§73): multi-row locks are acquired ONE ROW AT A
 * TIME in bin_code order. Sorting-then-locking in a single ORDER BY ... FOR
 * UPDATE statement does not guarantee acquisition order (the sort node may
 * lock rows in scan order), so per-row locking is the only deadlock-safe
 * pattern that is correct by construction.
 */
@Injectable()
export class InventoryBalanceRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Unlocked candidate balance ids for sku+warehouse+condition, bin_code order. */
  private async candidateIdsInBinOrder(
    runner: QueryRunner,
    skuId: string,
    warehouseId: string,
    condition: InventoryCondition,
  ): Promise<string[]> {
    const result = (await runner.query(
      `SELECT b.id
         FROM inventory_balances b
         JOIN warehouse_bins bin ON bin.id = b.bin_id
        WHERE b.sku_id = $1 AND b.warehouse_id = $2 AND b.inventory_condition = $3
        ORDER BY bin.bin_code ASC, b.id ASC`,
      [skuId, warehouseId, condition],
    )) as unknown as Array<{ id: string }>;
    return result.map((row) => row.id);
  }

  /** Locks one balance row (SELECT ... FOR UPDATE); null when absent. */
  async lockById(runner: QueryRunner, id: string): Promise<InventoryBalanceEntity | null> {
    return runner.manager
      .getRepository(InventoryBalanceEntity)
      .createQueryBuilder('b')
      .where('b.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  /**
   * Locks every balance row of (sku, warehouse, condition) in stable
   * bin_code order (task §24/§73). Rows are locked one at a time so every
   * transaction touching the same SKU acquires locks in the same sequence.
   */
  async lockAllInBinOrder(
    runner: QueryRunner,
    skuId: string,
    warehouseId: string,
    condition: InventoryCondition = 'SELLABLE',
  ): Promise<InventoryBalanceEntity[]> {
    const ids = await this.candidateIdsInBinOrder(runner, skuId, warehouseId, condition);
    const locked: InventoryBalanceEntity[] = [];
    for (const id of ids) {
      const row = await this.lockById(runner, id);
      if (row !== null) {
        locked.push(row);
      }
    }
    return locked;
  }

  /** Locks a single balance by full dimension; null when absent (NO_RECORD). */
  async lockByDim(runner: QueryRunner, dim: BalanceDim): Promise<InventoryBalanceEntity | null> {
    return runner.manager
      .getRepository(InventoryBalanceEntity)
      .createQueryBuilder('b')
      .where('b.skuId = :skuId', { skuId: dim.skuId })
      .andWhere('b.warehouseId = :warehouseId', { warehouseId: dim.warehouseId })
      .andWhere('b.binId = :binId', { binId: dim.binId })
      .andWhere('b.inventoryCondition = :condition', { condition: dim.condition })
      .setLock('pessimistic_write')
      .getOne();
  }

  /**
   * Get-or-create a balance row and lock it (initialize / receive / moveBin
   * target, task §20). Uses INSERT ... ON CONFLICT DO NOTHING: a plain
   * INSERT that loses the dimension race would ABORT the PG transaction
   * ("current transaction is aborted"), while ON CONFLICT keeps it usable.
   * A conflict against an uncommitted winner waits for that transaction,
   * then the follow-up SELECT ... FOR UPDATE returns the committed row.
   */
  async lockOrCreate(runner: QueryRunner, dim: BalanceDim): Promise<InventoryBalanceEntity> {
    const existing = await this.lockByDim(runner, dim);
    if (existing !== null) {
      return existing;
    }
    const inserted = (await runner.query(
      `INSERT INTO inventory_balances (id, sku_id, warehouse_id, bin_id, inventory_condition)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       ON CONFLICT (sku_id, warehouse_id, bin_id, inventory_condition) DO NOTHING
       RETURNING id`,
      [dim.skuId, dim.warehouseId, dim.binId, dim.condition],
    )) as unknown as Array<{ id: string }>;
    if (inserted.length > 0) {
      return (await this.lockById(runner, inserted[0]!.id)) as InventoryBalanceEntity;
    }
    const raced = await this.lockByDim(runner, dim);
    if (raced !== null) {
      return raced;
    }
    throw new Error('inventory balance get-or-create failed unexpectedly');
  }

  /** Persists mutated quantities; version is bumped by the caller's math. */
  async saveQuantities(
    runner: QueryRunner,
    id: string,
    patch: { onHandQty: string; reservedQty: string; pickedQty: string; version: string },
  ): Promise<void> {
    await runner.manager
      .getRepository(InventoryBalanceEntity)
      .update({ id }, { ...patch, updatedAt: new Date() });
  }
}

/** PG unique-constraint violation (23505), unwrapping TypeORM's QueryFailedError. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: string; driverError?: { code?: string } };
  return candidate.code === '23505' || candidate.driverError?.code === '23505';
}

export interface BalanceListFilters {
  keyword?: string;
  skuId?: string;
  warehouseId?: string;
  binId?: string;
  condition?: InventoryCondition;
  /** Computed row availability (task §41): IN_STOCK / OUT_OF_STOCK. */
  status?: 'IN_STOCK' | 'OUT_OF_STOCK';
}

export interface BalanceRowWithRefs {
  balance: InventoryBalanceEntity;
  skuCode: string;
  skuName: string;
  warehouseCode: string;
  warehouseName: string;
  binCode: string;
  safetyQty: string | null;
}

/** Read-model list query for the inventory page (single query, no N+1). */
export async function listBalancesWithRefs(
  dataSource: DataSource,
  filters: BalanceListFilters,
  limit: number,
  offset: number,
): Promise<{ rows: BalanceRowWithRefs[]; total: number }> {
  const qb = dataSource
    .getRepository(InventoryBalanceEntity)
    .createQueryBuilder('b')
    .innerJoin('skus', 'sku', 'sku.id = b.sku_id')
    .innerJoin('warehouses', 'wh', 'wh.id = b.warehouse_id')
    .innerJoin('warehouse_bins', 'bin', 'bin.id = b.bin_id')
    .leftJoin(
      'inventory_safety_stocks',
      'ss',
      'ss.sku_id = b.sku_id AND ss.warehouse_id = b.warehouse_id',
    )
    .addSelect('sku.sku_code', 'sku_code')
    .addSelect('sku.name_zh', 'sku_name')
    .addSelect('wh.warehouse_code', 'warehouse_code')
    .addSelect('wh.name', 'warehouse_name')
    .addSelect('bin.bin_code', 'bin_code')
    .addSelect('ss.safety_qty', 'safety_qty');

  if (filters.keyword !== undefined && filters.keyword !== '') {
    qb.andWhere('(sku.sku_code ILIKE :kw OR sku.name_zh ILIKE :kw)', {
      kw: `%${filters.keyword}%`,
    });
  }
  if (filters.skuId !== undefined) {
    qb.andWhere('b.skuId = :skuId', { skuId: filters.skuId });
  }
  if (filters.warehouseId !== undefined) {
    qb.andWhere('b.warehouseId = :warehouseId', { warehouseId: filters.warehouseId });
  }
  if (filters.binId !== undefined) {
    qb.andWhere('b.binId = :binId', { binId: filters.binId });
  }
  if (filters.condition !== undefined) {
    qb.andWhere('b.inventoryCondition = :condition', { condition: filters.condition });
  }
  if (filters.status === 'IN_STOCK') {
    qb.andWhere('(b.onHandQty - b.reservedQty - b.pickedQty) > 0');
  } else if (filters.status === 'OUT_OF_STOCK') {
    qb.andWhere('(b.onHandQty - b.reservedQty - b.pickedQty) <= 0');
  }

  // ORDER BY must reference entity properties only: raw-join aliases crash
  // TypeORM's getRawAndEntities order-by mapping (databaseName of undefined).
  qb.orderBy('b.skuId', 'ASC')
    .addOrderBy('b.warehouseId', 'ASC')
    .addOrderBy('b.binId', 'ASC')
    .skip(offset)
    .take(limit);

  const [{ raw: rawRows, entities }, total] = await Promise.all([
    qb.getRawAndEntities(),
    qb.getCount(),
  ]);
  const rawList = rawRows as Array<Record<string, unknown>>;
  const rows: BalanceRowWithRefs[] = entities.map((balance, index) => ({
    balance,
    skuCode: rawStr(rawList[index]?.['sku_code']),
    skuName: rawStr(rawList[index]?.['sku_name']),
    warehouseCode: rawStr(rawList[index]?.['warehouse_code']),
    warehouseName: rawStr(rawList[index]?.['warehouse_name']),
    binCode: rawStr(rawList[index]?.['bin_code']),
    safetyQty:
      rawList[index]?.['safety_qty'] === null || rawList[index]?.['safety_qty'] === undefined
        ? null
        : rawStr(rawList[index]['safety_qty']),
  }));
  return { rows, total };
}
