import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DomainError } from '../../../common/errors/domain.error';
import { formatQty, parseQty } from '../../../common/utils/quantity';

export interface SkuMergeInventoryResult {
  /** 合并/改指的余额行数 */
  balances: number;
  /** 被并入目标的实物数量合计（on_hand） */
  absorbedOnHand: string;
  /** 改指的占用量合计 */
  absorbedReserved: string;
  /** 改指的已拣量合计 */
  absorbedPicked: string;
  reservations: number;
  serials: number;
  safetyStocks: number;
  transactions: number;
  /** 重算过 before/after 的流水行数 */
  replayedTransactions: number;
}

/** 合并时库存账面无法安全归并（不变量或流水对不上）。 */
export class SkuMergeInventoryConflictError extends DomainError {
  readonly code = 'SKU_MERGE_INVENTORY_CONFLICT';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

interface BalanceRow {
  id: string;
  warehouse_id: string;
  bin_id: string;
  inventory_condition: string;
  on_hand_qty: string;
  reserved_qty: string;
  picked_qty: string;
}

interface LedgerRow {
  id: string;
  quantity_change: string | null;
  reserved_change: string | null;
  picked_change: string | null;
}

/**
 * SKU 合并的库存部分（2026-10-24，用户拍板）。
 *
 * 语义：两个 SKU 档案记的是**同一件实物**，所以这是「账面身份归并」，不是实物
 * 移动。因此：
 *   1. 现状数量（余额/占用/已拣/流水/预留/序列号/安全库存）整体迁到目标 SKU；
 *   2. 同 (仓, 库位, 状态) 的余额三项相加，源行删除；
 *   3. 流水改指后按 (仓, 库位) **按时间重放**，重算 before/after，
 *      保证「Σ流水 = 余额」（AGENTS §14）且账链连续；
 *   4. 重放终值必须等于合并后的余额，否则整体拒绝（说明历史本身缺行/被手改）。
 *
 * 本服务只由 SKU 合并服务在**其事务内**调用；所有写入都走本模块，别的模块不碰
 * inventory_* 表（AGENTS §10）。
 */
@Injectable()
export class SkuMergeInventoryService {
  /**
   * 在调用方事务内归并两个 SKU 的库存账面。
   * 失败一律抛出（由调用方回滚整个合并）。
   */
  async mergeInTx(
    manager: EntityManager,
    input: { sourceSkuId: string; targetSkuId: string },
  ): Promise<SkuMergeInventoryResult> {
    const { sourceSkuId, targetSkuId } = input;

    const conditions = await manager.query<Array<{ inventory_condition: string }>>(
      `SELECT DISTINCT inventory_condition FROM inventory_balances WHERE sku_id = $1::uuid`,
      [sourceSkuId],
    );
    // 流水没有 condition 维度：只支持单一状态（当前库里全部 SELLABLE）。
    // 将来引入其它状态时必须先扩展流水维度，绝不能在这里静默串账。
    const nonSellable = conditions.filter((row) => row.inventory_condition !== 'SELLABLE');
    if (nonSellable.length > 0) {
      throw new SkuMergeInventoryConflictError(
        '源 SKU 存在非 SELLABLE 状态的库存余额，暂不支持合并',
        { conditions: nonSellable.map((row) => row.inventory_condition) },
      );
    }

    const sourceBalances = await manager.query<BalanceRow[]>(
      `SELECT id, warehouse_id, bin_id, inventory_condition,
              on_hand_qty, reserved_qty, picked_qty
         FROM inventory_balances
        WHERE sku_id = $1::uuid
        FOR UPDATE`,
      [sourceSkuId],
    );

    let onHandTotal = 0n;
    let reservedTotal = 0n;
    let pickedTotal = 0n;
    let balancesMerged = 0;

    for (const row of sourceBalances) {
      const onHand = parseQty(row.on_hand_qty);
      const reserved = parseQty(row.reserved_qty);
      const picked = parseQty(row.picked_qty);
      onHandTotal += onHand;
      reservedTotal += reserved;
      pickedTotal += picked;

      const targetRows = await manager.query<BalanceRow[]>(
        `SELECT id, warehouse_id, bin_id, inventory_condition,
                on_hand_qty, reserved_qty, picked_qty
           FROM inventory_balances
          WHERE sku_id = $1::uuid AND warehouse_id = $2::uuid
            AND bin_id = $3::uuid AND inventory_condition = $4
          FOR UPDATE`,
        [targetSkuId, row.warehouse_id, row.bin_id, row.inventory_condition],
      );

      const target = targetRows[0];
      if (target === undefined) {
        // 不同维度：直接改指，数量不动（流水随后整体改指并重放）。
        await manager.query(
          `UPDATE inventory_balances SET sku_id = $2::uuid, updated_at = now()
            WHERE id = $1::uuid`,
          [row.id, targetSkuId],
        );
      } else {
        const merged = {
          onHandQty: formatQty(parseQty(target.on_hand_qty) + onHand),
          reservedQty: formatQty(parseQty(target.reserved_qty) + reserved),
          pickedQty: formatQty(parseQty(target.picked_qty) + picked),
        };
        assertNonNegative(merged, row);
        await manager.query(
          `UPDATE inventory_balances
              SET on_hand_qty = $2, reserved_qty = $3, picked_qty = $4,
                  version = version + 1, updated_at = now()
            WHERE id = $1::uuid`,
          [target.id, merged.onHandQty, merged.reservedQty, merged.pickedQty],
        );
        await manager.query(`DELETE FROM inventory_balances WHERE id = $1::uuid`, [row.id]);
      }
      balancesMerged += 1;
    }

    const reservations = await countUpdated(
      manager.query(
        `UPDATE inventory_reservations SET sku_id = $2::uuid, updated_at = now()
          WHERE sku_id = $1::uuid RETURNING id`,
        [sourceSkuId, targetSkuId],
      ),
    );

    let serials: number;
    try {
      serials = await countUpdated(
        manager.query(
          `UPDATE inventory_serials SET sku_id = $2::uuid, updated_at = now()
            WHERE sku_id = $1::uuid RETURNING id`,
          [sourceSkuId, targetSkuId],
        ),
      );
    } catch (error: unknown) {
      throw new SkuMergeInventoryConflictError(
        '序列号在两个 SKU 上重复（同一台实物被记了两次），拒绝合并',
        { reason: error instanceof Error ? error.message : String(error) },
      );
    }

    // 安全库存是策略阈值，不能相加：目标缺该仓时继承源的，否则丢弃源的。
    const safetyStocks = await countUpdated(
      manager.query(
        `UPDATE inventory_safety_stocks ss
            SET sku_id = $2::uuid, updated_at = now()
          WHERE ss.sku_id = $1::uuid
            AND NOT EXISTS (
              SELECT 1 FROM inventory_safety_stocks t
               WHERE t.sku_id = $2::uuid AND t.warehouse_id = ss.warehouse_id
            )
        RETURNING id`,
        [sourceSkuId, targetSkuId],
      ),
    );
    await manager.query(`DELETE FROM inventory_safety_stocks WHERE sku_id = $1::uuid`, [
      sourceSkuId,
    ]);

    const transactions = await countUpdated(
      manager.query(
        `UPDATE inventory_transactions SET sku_id = $2::uuid
          WHERE sku_id = $1::uuid RETURNING id`,
        [sourceSkuId, targetSkuId],
      ),
    );

    const replayedTransactions = await this.replayLedger(manager, targetSkuId);

    return {
      balances: balancesMerged,
      absorbedOnHand: formatQty(onHandTotal),
      absorbedReserved: formatQty(reservedTotal),
      absorbedPicked: formatQty(pickedTotal),
      reservations,
      serials,
      safetyStocks,
      transactions,
      replayedTransactions,
    };
  }

  /**
   * 按 (仓, 库位) 重放流水：从 0 开始累加 change，重写 before/after。
   * 终值必须等于当前余额（同维度合计），否则拒绝合并。
   */
  private async replayLedger(manager: EntityManager, skuId: string): Promise<number> {
    const dims = (await manager.query<Array<{ warehouse_id: string; bin_id: string }>>(
      `SELECT DISTINCT warehouse_id, bin_id
         FROM inventory_transactions WHERE sku_id = $1::uuid`,
      [skuId],
    )) as Array<{ warehouse_id: string; bin_id: string }>;

    let updated = 0;
    for (const dim of dims) {
      const rows = await manager.query<LedgerRow[]>(
        `SELECT id, quantity_change, reserved_change, picked_change
           FROM inventory_transactions
          WHERE sku_id = $1::uuid AND warehouse_id = $2::uuid AND bin_id = $3::uuid
          ORDER BY created_at ASC, id ASC`,
        [skuId, dim.warehouse_id, dim.bin_id],
      );

      let onHand = 0n;
      let reserved = 0n;
      let picked = 0n;
      const updates: Array<[string, string, string, string, string, string, string]> = [];
      for (const row of rows) {
        const onBefore = onHand;
        const resBefore = reserved;
        const pickBefore = picked;
        onHand += parseQty(row.quantity_change ?? '0');
        reserved += parseQty(row.reserved_change ?? '0');
        picked += parseQty(row.picked_change ?? '0');
        updates.push([
          row.id,
          formatQty(onBefore),
          formatQty(onHand),
          formatQty(resBefore),
          formatQty(reserved),
          formatQty(pickBefore),
          formatQty(picked),
        ]);
      }

      const balanceRows = await manager.query<BalanceRow[]>(
        `SELECT on_hand_qty, reserved_qty, picked_qty
           FROM inventory_balances
          WHERE sku_id = $1::uuid AND warehouse_id = $2::uuid AND bin_id = $3::uuid
            AND inventory_condition = 'SELLABLE'`,
        [skuId, dim.warehouse_id, dim.bin_id],
      );
      const expectedOnHand = balanceRows.reduce((sum, row) => sum + parseQty(row.on_hand_qty), 0n);
      const expectedReserved = balanceRows.reduce(
        (sum, row) => sum + parseQty(row.reserved_qty),
        0n,
      );
      const expectedPicked = balanceRows.reduce((sum, row) => sum + parseQty(row.picked_qty), 0n);
      if (
        rows.length > 0 &&
        (onHand !== expectedOnHand || reserved !== expectedReserved || picked !== expectedPicked)
      ) {
        throw new SkuMergeInventoryConflictError(
          '流水重算结果与库存余额不一致，拒绝合并（历史流水可能缺行或被手工修改）',
          {
            warehouseId: dim.warehouse_id,
            binId: dim.bin_id,
            ledger: {
              onHand: formatQty(onHand),
              reserved: formatQty(reserved),
              picked: formatQty(picked),
            },
            balance: {
              onHand: formatQty(expectedOnHand),
              reserved: formatQty(expectedReserved),
              picked: formatQty(expectedPicked),
            },
          },
        );
      }

      if (updates.length > 0) {
        await manager.query(
          `UPDATE inventory_transactions t
              SET quantity_before = v.qb, quantity_after = v.qa,
                  reserved_before = v.rb, reserved_after = v.ra,
                  picked_before = v.pb, picked_after = v.pa
             FROM (SELECT * FROM unnest(
                     $1::uuid[], $2::numeric[], $3::numeric[],
                     $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[]
                   ) AS x(id, qb, qa, rb, ra, pb, pa)) v
            WHERE t.id = v.id`,
          [
            updates.map((row) => row[0]),
            updates.map((row) => row[1]),
            updates.map((row) => row[2]),
            updates.map((row) => row[3]),
            updates.map((row) => row[4]),
            updates.map((row) => row[5]),
            updates.map((row) => row[6]),
          ],
        );
        updated += updates.length;
      }
    }
    return updated;
  }
}

function assertNonNegative(
  merged: { onHandQty: string; reservedQty: string; pickedQty: string },
  source: BalanceRow,
): void {
  const onHand = parseQty(merged.onHandQty);
  const reserved = parseQty(merged.reservedQty);
  const picked = parseQty(merged.pickedQty);
  if (onHand < 0n || reserved < 0n || picked < 0n) {
    throw new SkuMergeInventoryConflictError('合并后库存为负，拒绝合并', {
      balanceId: source.id,
    });
  }
  if (reserved + picked > onHand) {
    throw new SkuMergeInventoryConflictError('合并后占用超出实物数量，拒绝合并', {
      balanceId: source.id,
      onHand: merged.onHandQty,
      reserved: merged.reservedQty,
      picked: merged.pickedQty,
    });
  }
}

async function countUpdated(query: Promise<unknown>): Promise<number> {
  const result = await query;
  // TypeORM 裸 UPDATE ... RETURNING 在部分驱动下返回 [rows, rowCount] 二元组。
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return (result[0] as unknown[]).length;
  }
  return Array.isArray(result) ? result.length : 0;
}
