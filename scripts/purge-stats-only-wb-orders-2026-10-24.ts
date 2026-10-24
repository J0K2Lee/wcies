/**
 * 一次性数据修复（2026-10-24）：删除「只从 WB 统计流水建出来」的幽灵订单。
 *
 * 背景：WB 订单同步是双源（v3 装配任务 + statistics 销售报表）。报表包含
 * 卖家仓（FBS）订单，但这类单的作业事实源是 v3；v3 里没有 = 已经装配走/取消。
 * 修复前把它们当订单建了出来，得到 7 张「只有订单 UID（srid）、平台后台搜不到、
 * 也没有任何可执行动作」的单：
 *   - 3 张 NEW + 行 EXTERNAL_FULFILLED（履约方式被后续修复从 FBW 改回 FBS，行没重算）
 *   - 2 张 EXCEPTION（映射失败）
 *   - 2 张 CANCELLED（平台侧取消）
 *
 * 判定：`raw_data ? 'srid'` 且**没有**任何订单的 `rid` 等于该 srid（即没有 v3 孪生单）。
 * 安全边界同 purge：任何业务事实（库存流水/占用/拣货/发货/结算/财务/拦截/面单/
 * 采购引用）存在即跳过。
 *
 * 用法：
 *   npx tsx --env-file=.env scripts/purge-stats-only-wb-orders-2026-10-24.ts
 *   npx tsx --env-file=.env scripts/purge-stats-only-wb-orders-2026-10-24.ts --execute
 */
import { Client } from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXECUTE = process.argv.includes('--execute');
const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined || connectionString === '') {
  throw new Error('需要 DATABASE_URL');
}
if (!connectionString.includes('wcies_dev') && !connectionString.includes('wcies_test')) {
  throw new Error('拒绝执行：只允许 wcies_dev / wcies_test（生产环境默认拒绝，AGENTS §93）');
}

interface Row {
  id: string;
  order_no: string;
  platform_order_id: string;
  erp_status: string;
  items: number;
  [sideEffect: string]: string | number;
}

const SIDE_EFFECT_KEYS = [
  'ledger',
  'reservations',
  'picking',
  'shipments',
  'settlements',
  'settlement_items',
  'finance',
  'interceptions',
  'labels',
  'purchase_items',
] as const;

const CANDIDATES_SQL = `
  SELECT o.id, o.order_no, o.platform_order_id, o.erp_status,
         (SELECT count(*) FROM order_items i WHERE i.order_id = o.id)::int AS items,
         (SELECT count(*) FROM inventory_transactions t
           WHERE (t.reference_type = 'ORDER' AND t.reference_id = o.id)
              OR (t.reference_type = 'ORDER_ITEM' AND t.reference_id IN (SELECT id FROM order_items x WHERE x.order_id = o.id)))::int AS ledger,
         (SELECT count(*) FROM inventory_reservations r
           WHERE (r.reference_type = 'ORDER' AND r.reference_id = o.id)
              OR (r.reference_type = 'ORDER_ITEM' AND r.reference_id IN (SELECT id FROM order_items x WHERE x.order_id = o.id)))::int AS reservations,
         (SELECT count(*) FROM picking_task_items p WHERE p.order_id = o.id)::int AS picking,
         (SELECT count(*) FROM shipments s WHERE s.order_id = o.id)::int AS shipments,
         (SELECT count(*) FROM order_settlements s WHERE s.order_id = o.id)::int AS settlements,
         (SELECT count(*) FROM order_settlement_items s
           WHERE s.order_item_id IN (SELECT id FROM order_items x WHERE x.order_id = o.id))::int AS settlement_items,
         (SELECT count(*) FROM finance_transactions f WHERE f.order_id = o.id)::int AS finance,
         (SELECT count(*) FROM order_interceptions x WHERE x.order_id = o.id)::int AS interceptions,
         (SELECT count(*) FROM shipping_labels l WHERE l.order_id = o.id)::int AS labels,
         (SELECT count(*) FROM purchase_order_items p
           WHERE p.order_item_id IN (SELECT id FROM order_items x WHERE x.order_id = o.id))::int AS purchase_items
    FROM orders o
   WHERE o.raw_data ? 'srid'
     AND NOT EXISTS (
       SELECT 1 FROM orders twin
        WHERE twin.store_id = o.store_id
          AND twin.id <> o.id
          AND twin.raw_data->>'rid' = o.raw_data->>'srid')
   ORDER BY o.order_no`;

async function main(): Promise<void> {
  const db = new Client({ connectionString });
  await db.connect();
  try {
    const candidates = await db.query<Row>(CANDIDATES_SQL);
    if (candidates.rows.length === 0) {
      console.log('没有发现「只从统计流水建出来」的订单，无事可做。');
      return;
    }
    console.log(`发现统计源幽灵单 ${candidates.rows.length} 张：\n`);
    const deletable: Row[] = [];
    for (const row of candidates.rows) {
      const blockers = SIDE_EFFECT_KEYS.filter((key) => Number(row[key]) > 0).map(
        (key) => `${key}=${String(row[key])}`,
      );
      console.log(
        `  ${row.order_no}  ${row.platform_order_id.slice(0, 30)}  ${row.erp_status}  ` +
          `明细 ${row.items} 行  → ${blockers.length === 0 ? '可删除' : `跳过（${blockers.join('，')}）`}`,
      );
      if (blockers.length === 0) {
        deletable.push(row);
      }
    }
    if (!EXECUTE) {
      console.log(`\n[dry-run] 将删除 ${deletable.length} 张；加 --execute 执行。`);
      return;
    }
    if (deletable.length === 0) {
      console.log('\n没有可安全删除的幽灵单。');
      return;
    }

    const ids = deletable.map((row) => row.id);
    const snapshot = {
      takenAt: new Date().toISOString(),
      reason: 'WB 统计流水只有 srid、无 v3 装配任务孪生单（幽灵单，不属于我们的待办）',
      orders: (await db.query(`SELECT * FROM orders WHERE id = ANY($1::uuid[])`, [ids])).rows,
      items: (await db.query(`SELECT * FROM order_items WHERE order_id = ANY($1::uuid[])`, [ids]))
        .rows,
      statusHistory: (
        await db.query(`SELECT * FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [ids])
      ).rows,
      platformStatusHistory: (
        await db.query(`SELECT * FROM platform_status_history WHERE order_id = ANY($1::uuid[])`, [
          ids,
        ])
      ).rows,
      exceptions: (
        await db.query(
          `SELECT * FROM system_exceptions
            WHERE (reference_type = 'ORDER' AND reference_id = ANY($1::uuid[]))
               OR (reference_type = 'ORDER_ITEM' AND reference_id IN
                     (SELECT id FROM order_items WHERE order_id = ANY($1::uuid[])))`,
          [ids],
        )
      ).rows,
    };
    const backupDir = resolve(process.cwd(), '.workbuddy/backup');
    mkdirSync(backupDir, { recursive: true });
    const backupPath = resolve(backupDir, `purged-stats-only-orders-${Date.now()}.json`);
    writeFileSync(backupPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    console.log(`\n快照已写入 ${backupPath}`);

    await db.query('BEGIN');
    try {
      const exceptions = await db.query(
        `DELETE FROM system_exceptions
          WHERE (reference_type = 'ORDER' AND reference_id = ANY($1::uuid[]))
             OR (reference_type = 'ORDER_ITEM' AND reference_id IN
                   (SELECT id FROM order_items WHERE order_id = ANY($1::uuid[])))`,
        [ids],
      );
      const platformHistory = await db.query(
        `DELETE FROM platform_status_history WHERE order_id = ANY($1::uuid[])`,
        [ids],
      );
      const history = await db.query(
        `DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`,
        [ids],
      );
      const items = await db.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [
        ids,
      ]);
      const orders = await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids]);
      await db.query('COMMIT');
      console.log(
        `\n已删除：订单 ${orders.rowCount ?? 0} 张、明细 ${items.rowCount ?? 0} 行、` +
          `状态历史 ${history.rowCount ?? 0} 条、平台状态 ${platformHistory.rowCount ?? 0} 条、` +
          `异常 ${exceptions.rowCount ?? 0} 条。`,
      );
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } finally {
    await db.end();
  }
}

void main();
