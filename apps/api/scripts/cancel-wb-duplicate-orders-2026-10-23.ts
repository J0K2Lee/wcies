/**
 * 一次性数据修复：取消 WB 的重复订单（2026-10-23 用户 bug）。
 *
 * 背景：WB 订单同步有两个数据源——
 *   1. FBS 任务流 `/api/v3/orders`：platform_order_id = 数字组货单 id；
 *   2. 统计流水 `/api/v1/supplier/orders`：platform_order_id = `srid`
 *      （形如 `eBH.<orderUid>.0.0`，等于第 1 个源里订单的 `rid`）。
 * 统计流水**包含全部订单**，而 mapper 之前一律按 FBW（平台仓）落库，于是同一张
 * 单出现两条记录（一条 FBS、一条 FBW），后者还错误地进入「外部履约」。
 *
 * 代码已修（按仓库类型判履约方式 + 按 rid 去重），但存量重复记录还在。本脚本
 * 把重复的那条**取消**（不改动原始 FBS 订单，不删数据，可追溯）：
 *   - 判定：同店铺内 A.raw_data->>'rid' = B.platform_order_id 且 B 的 id 含 '.'；
 *   - 只处理 B（后摄入的统计行），A 是权威记录；
 *   - 已 CANCELLED 的跳过。
 *
 * 安全（AGENTS §89/§93）：
 *   - 默认 DRY RUN，`--apply` 才写；
 *   - 拒绝 NODE_ENV=production；
 *   - 先整表快照到 .workbuddy/backup/，再执行。
 *
 * Usage:
 *   tsx scripts/cancel-wb-duplicate-orders-2026-10-23.ts            # dry run
 *   tsx scripts/cancel-wb-duplicate-orders-2026-10-23.ts --apply    # 执行
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });

const REASON = '重复摄入：WB 统计流水与 FBS 任务流为同一订单（2026-10-23 修复）';

interface DuplicateRow {
  store_code: string;
  dup_id: string;
  dup_order_no: string;
  dup_status: string;
  dup_platform_order_id: string;
  orig_order_no: string;
  orig_platform_order_id: string;
  orig_status: string;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('拒绝在 production 环境执行（AGENTS §93）');
  }
  const apply = process.argv.includes('--apply');
  const { NestFactory } = await import('@nestjs/core');
  const { DataSource } = await import('typeorm');
  const { AppModule } = await import('../dist/app.module.js');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const ds = app.get(DataSource);
    const rows = await ds.query<DuplicateRow[]>(`
      SELECT st.store_code,
             dup.id AS dup_id, dup.order_no AS dup_order_no, dup.erp_status AS dup_status,
             dup.platform_order_id AS dup_platform_order_id,
             orig.order_no AS orig_order_no,
             orig.platform_order_id AS orig_platform_order_id,
             orig.erp_status AS orig_status
        FROM orders dup
        JOIN orders orig
          ON orig.store_id = dup.store_id
         AND orig.raw_data->>'rid' = dup.platform_order_id
         AND orig.id <> dup.id
        JOIN stores st ON st.id = dup.store_id
       WHERE dup.platform_order_id LIKE '%.%'
       ORDER BY st.store_code, dup.order_no
    `);

    const pending = rows.filter((row) => row.dup_status !== 'CANCELLED');
    console.log(`发现重复订单 ${rows.length} 条（其中待处理 ${pending.length} 条）`);
    for (const row of pending) {
      console.log(
        `  ${row.store_code} ${row.dup_order_no} [${row.dup_status}] id=${row.dup_platform_order_id}` +
          ` ← 权威记录 ${row.orig_order_no} [${row.orig_status}] id=${row.orig_platform_order_id}`,
      );
    }
    if (!apply) {
      console.log('\nDRY RUN：未写任何数据。确认无误后加 --apply 执行。');
      return;
    }

    const backupDir = resolve(__dirname, '../../../.workbuddy/backup');
    mkdirSync(backupDir, { recursive: true });
    const backupPath = resolve(backupDir, `wb-duplicate-orders-${Date.now()}.json`);
    writeFileSync(backupPath, JSON.stringify(pending, null, 2), 'utf8');
    console.log(`\n快照已写入 ${backupPath}`);

    const { OrderService } = await import('../dist/modules/order/services/order.service.js');
    const orders = app.get(OrderService);
    const operator = { userId: null, username: 'data-fix-2026-10-23' };
    let cancelled = 0;
    for (const row of pending) {
      try {
        await orders.cancel(row.dup_id, operator, REASON);
        cancelled += 1;
        console.log(`  已取消 ${row.dup_order_no}`);
      } catch (error: unknown) {
        console.error(
          `  取消失败 ${row.dup_order_no}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    console.log(`\n完成：取消 ${cancelled} / ${pending.length}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
