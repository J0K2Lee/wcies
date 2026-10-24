/**
 * 一次性数据修复（2026-10-24）：删除 WB 统计流水重复建出的订单。
 *
 * 背景：WB 订单同步有两路数据源。统计流水 (/api/v1/supplier/orders) 返回全部
 * 订单，早期把卖家仓的 FBS 单也建了一遍，同一个平台订单因此有两张 ERP 单：
 *   - FBS 任务流：platform_order_id = 数字组货单 id，raw_data.rid = <srid>
 *   - 统计流水：platform_order_id = <srid>
 * 修复（5f69b56）已按 warehouseType 判履约方式 + 按 rid 去重，不再产生新的；
 * 存量重复单当时被「取消」，但用户指示（2026-10-24）：**错误摄入的单本不该
 * 存在，应当彻底移除**，不是取消。
 *
 * 安全边界（AGENTS §14/§101.10）：只删除**没有任何业务事实**的重复单——
 * 没有库存流水/占用/拣货/发货/结算/财务/拦截/面单/采购引用。任一命中即跳过
 * 并打印原因，交人工走取消 + 正式流程。
 *
 * 用法：
 *   npx tsx --env-file=.env scripts/purge-duplicate-wb-orders-2026-10-24.ts
 *   npx tsx --env-file=.env scripts/purge-duplicate-wb-orders-2026-10-24.ts --execute
 *
 * 默认 dry-run。执行前把将被删除的行快照到 .workbuddy/backup/。
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

const DUPLICATES_SQL = `
  SELECT d.id, d.order_no, d.platform_order_id, d.erp_status, d.store_id,
         d.raw_data->>'srid' AS srid, d.raw_data->>'rid' AS rid,
         twin.order_no AS twin_order_no, twin.platform_order_id AS twin_platform_order_id,
         (SELECT count(*) FROM order_items i WHERE i.order_id = d.id)::int AS items,
         (SELECT count(*) FROM inventory_transactions t
           WHERE (t.reference_type = 'ORDER' AND t.reference_id = d.id)
              OR (t.reference_type = 'ORDER_ITEM' AND t.reference_id IN (SELECT id FROM order_items i WHERE i.order_id = d.id)))::int AS ledger,
         (SELECT count(*) FROM inventory_reservations r
           WHERE (r.reference_type = 'ORDER' AND r.reference_id = d.id)
              OR (r.reference_type = 'ORDER_ITEM' AND r.reference_id IN (SELECT id FROM order_items i WHERE i.order_id = d.id)))::int AS reservations,
         (SELECT count(*) FROM picking_task_items p WHERE p.order_id = d.id)::int AS picking,
         (SELECT count(*) FROM shipments s WHERE s.order_id = d.id)::int AS shipments,
         (SELECT count(*) FROM order_settlements s WHERE s.order_id = d.id)::int AS settlements,
         (SELECT count(*) FROM order_settlement_items s
           WHERE s.order_item_id IN (SELECT id FROM order_items i WHERE i.order_id = d.id))::int AS settlement_items,
         (SELECT count(*) FROM finance_transactions f WHERE f.order_id = d.id)::int AS finance,
         (SELECT count(*) FROM order_interceptions x WHERE x.order_id = d.id)::int AS interceptions,
         (SELECT count(*) FROM shipping_labels l WHERE l.order_id = d.id)::int AS labels,
         (SELECT count(*) FROM purchase_order_items p
           WHERE p.order_item_id IN (SELECT id FROM order_items i WHERE i.order_id = d.id))::int AS purchase_items
    FROM orders d
    JOIN LATERAL (
      SELECT o2.order_no, o2.platform_order_id
        FROM orders o2
       WHERE o2.store_id = d.store_id
         AND o2.id <> d.id
         AND o2.raw_data->>'rid' = d.raw_data->>'srid'
       LIMIT 1
    ) twin ON TRUE
   WHERE d.raw_data->>'srid' IS NOT NULL
   ORDER BY d.order_no`;

interface DuplicateRow {
  id: string;
  order_no: string;
  platform_order_id: string;
  erp_status: string;
  store_id: string;
  srid: string | null;
  rid: string | null;
  twin_order_no: string;
  twin_platform_order_id: string;
  items: number;
  [sideEffect: string]: string | number | null;
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

async function main(): Promise<void> {
  const db = new Client({ connectionString });
  await db.connect();
  try {
    const duplicates = await db.query<DuplicateRow>(DUPLICATES_SQL);
    if (duplicates.rows.length === 0) {
      console.log('没有发现重复订单，无事可做。');
      return;
    }
    console.log(`发现重复订单 ${duplicates.rows.length} 张：\n`);
    const deletable: DuplicateRow[] = [];
    for (const row of duplicates.rows) {
      const blockers = SIDE_EFFECT_KEYS.filter((key) => Number(row[key] ?? 0) > 0).map(
        (key) => `${key}=${String(row[key])}`,
      );
      const tag = blockers.length === 0 ? '可删除' : `跳过（${blockers.join('，')}）`;
      console.log(
        `  ${row.order_no}  ${row.platform_order_id.slice(0, 30)}  ${row.erp_status}  ` +
          `明细 ${row.items} 行  对应 ${row.twin_order_no}  → ${tag}`,
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
      console.log('\n没有可安全删除的重复单。');
      return;
    }

    const ids = deletable.map((row) => row.id);
    const snapshot = {
      takenAt: new Date().toISOString(),
      reason: 'WB 统计流水重复建单（FBS 任务流为权威记录）',
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
    const backupPath = resolve(backupDir, `purged-duplicate-orders-${Date.now()}.json`);
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
