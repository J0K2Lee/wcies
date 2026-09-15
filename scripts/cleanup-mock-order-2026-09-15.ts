/**
 * One-off cleanup: remove the re-created synthetic ingest test order
 * `ORD00000005` (2026-09-15).
 *
 * Same test scene as `cleanup-test-residue-2026-09-14.ts` target B: a
 * manually-ingested order with platform_order_id `MOCK-D-001` and a
 * deliberately unmapped platform SKU, used to exercise the mapping-failure /
 * repair flow. The user asked for it to be removed before starting the scan
 * workflow acceptance (docs/WCIES_扫码出入库_落地与演进方案_V1.md 第一阶段).
 *
 * Why deletion is safe here:
 *   - sync_source = 'API' and platform_order_id = 'MOCK-D-001' - no OZON
 *     posting backs it, so polling/webhook can never re-ingest it;
 *   - zero reservations, zero picking/shipment/interception rows - no
 *     inventory movement ever referenced it (decision 0003 premises hold).
 * The four REAL OZON orders (ORD00000001..04) are asserted to survive.
 *
 * Safety (AGENTS.md §89/§93):
 *   - refuses to run when NODE_ENV=production;
 *   - DRY RUN by default - pass `--apply` to delete;
 *   - targets hard-coded by business key; nothing matched by pattern;
 *   - preflight assertions fail loudly when reality differs;
 *   - `--apply` first dumps every doomed row to backups/ as JSON, then
 *     deletes in ONE transaction, printing before/after counts.
 *
 * Usage:
 *   tsx scripts/cleanup-mock-order-2026-09-15.ts            # dry run
 *   tsx scripts/cleanup-mock-order-2026-09-15.ts --apply    # backup + delete
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

config({ path: resolve(import.meta.dirname, '../.env'), quiet: true });

const TEST_ORDER_NO = 'ORD00000005';
const TEST_ORDER_PLATFORM_ID = 'MOCK-D-001';
/** Real orders that MUST still exist after the cleanup. */
const REAL_ORDER_NOS = ['ORD00000001', 'ORD00000002', 'ORD00000003', 'ORD00000004'];

function fail(message: string): never {
  console.error(`[cleanup] ABORT: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (process.env.NODE_ENV === 'production') {
    fail('NODE_ENV=production - this cleanup must never run against production.');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    fail('DATABASE_URL is not set.');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  console.log(`[cleanup] database: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`[cleanup] mode: ${apply ? 'APPLY (backup + delete)' : 'DRY RUN (no writes)'}`);

  try {
    // ---- Preflight: identity of the target ---------------------------------
    const order = (
      await client.query<{
        id: string;
        order_no: string;
        platform_order_id: string;
        sync_source: string;
        erp_status: string;
      }>(
        `SELECT id, order_no, platform_order_id, sync_source, erp_status
           FROM orders WHERE order_no = $1`,
        [TEST_ORDER_NO],
      )
    ).rows[0];

    if (order === undefined) {
      console.log(`[cleanup] ${TEST_ORDER_NO} not found - nothing to do.`);
      return;
    }
    if (order.platform_order_id !== TEST_ORDER_PLATFORM_ID) {
      fail(
        `${TEST_ORDER_NO} carries platform_order_id=${order.platform_order_id}, expected ${TEST_ORDER_PLATFORM_ID} - this is not the synthetic test scene.`,
      );
    }
    if (order.sync_source !== 'API') {
      fail(
        `${TEST_ORDER_NO} has sync_source=${order.sync_source}, expected 'API'. WEBHOOK/POLLING means a real OZON order - deletion is not authorized.`,
      );
    }
    if (order.erp_status !== 'CANCELLED') {
      fail(`${TEST_ORDER_NO} is ${order.erp_status}, expected CANCELLED - cancel it first.`);
    }

    const blocking = (
      await client.query<{
        picking: string;
        shipments: string;
        interceptions: string;
        unreserved_items: string;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM picking_task_items WHERE order_id = $1)::text AS picking,
           (SELECT COUNT(*) FROM shipments WHERE order_id = $1)::text AS shipments,
           (SELECT COUNT(*) FROM order_interceptions WHERE order_id = $1)::text AS interceptions,
           (SELECT COUNT(*) FROM order_items WHERE order_id = $1 AND reservation_id IS NOT NULL)::text AS unreserved_items`,
        [order.id],
      )
    ).rows[0];
    if (
      blocking !== undefined &&
      (blocking.picking !== '0' ||
        blocking.shipments !== '0' ||
        blocking.interceptions !== '0' ||
        blocking.unreserved_items !== '0')
    ) {
      fail(`${TEST_ORDER_NO} has live references: ${JSON.stringify(blocking)}.`);
    }

    const itemIds = (
      await client.query<{ id: string }>('SELECT id FROM order_items WHERE order_id = $1', [
        order.id,
      ])
    ).rows.map((row) => row.id);

    // ---- Dry run: show exactly what would go ------------------------------
    const preview = await client.query<{ table_name: string; rows: string }>(
      `SELECT 'orders' AS table_name, COUNT(*)::text AS rows FROM orders WHERE id = $1
       UNION ALL SELECT 'order_items', COUNT(*)::text FROM order_items WHERE order_id = $1
       UNION ALL SELECT 'order_status_history', COUNT(*)::text FROM order_status_history WHERE order_id = $1
       UNION ALL SELECT 'system_exceptions(by item)', COUNT(*)::text FROM system_exceptions WHERE reference_id = ANY($2::uuid[])
       UNION ALL SELECT 'system_exceptions(by order)', COUNT(*)::text FROM system_exceptions WHERE reference_id = $1
       UNION ALL SELECT 'notifications(by order/exceptions)', COUNT(*)::text FROM notifications
         WHERE reference_id = $1
            OR reference_id IN (SELECT id FROM system_exceptions WHERE reference_id = ANY($2::uuid[]) OR reference_id = $1)`,
      [order.id, itemIds],
    );
    console.table(preview.rows);

    if (!apply) {
      console.log('[cleanup] dry run complete. Re-run with --apply to backup + delete.');
      return;
    }

    // ---- Backup (§89): every doomed row to backups/ before any delete -----
    const backup = {
      capturedAt: new Date().toISOString(),
      order: (await client.query('SELECT * FROM orders WHERE id = $1', [order.id])).rows,
      order_items: (await client.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]))
        .rows,
      order_status_history: (
        await client.query('SELECT * FROM order_status_history WHERE order_id = $1', [order.id])
      ).rows,
      system_exceptions: (
        await client.query(
          'SELECT * FROM system_exceptions WHERE reference_id = ANY($1::uuid[]) OR reference_id = $2',
          [itemIds, order.id],
        )
      ).rows,
      notifications: (
        await client.query(
          `SELECT * FROM notifications WHERE reference_id = $1
             OR reference_id IN (SELECT id FROM system_exceptions WHERE reference_id = ANY($2::uuid[]) OR reference_id = $1)`,
          [order.id, itemIds],
        )
      ).rows,
    };
    const backupPath = resolve(
      import.meta.dirname,
      '../backups/cleanup-mock-order-2026-09-15.json',
    );
    mkdirSync(resolve(import.meta.dirname, '../backups'), { recursive: true });
    writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`[cleanup] backup written: ${backupPath}`);

    // ---- Apply: one transaction, child rows first -------------------------
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM notifications WHERE reference_id = $1
         OR reference_id IN (SELECT id FROM system_exceptions WHERE reference_id = ANY($2::uuid[]) OR reference_id = $1)`,
      [order.id, itemIds],
    );
    await client.query('DELETE FROM order_status_history WHERE order_id = $1', [order.id]);
    await client.query(
      'DELETE FROM system_exceptions WHERE reference_id = ANY($1::uuid[]) OR reference_id = $2',
      [itemIds, order.id],
    );
    await client.query('DELETE FROM order_items WHERE order_id = $1', [order.id]);
    await client.query('DELETE FROM orders WHERE id = $1', [order.id]);
    await client.query('COMMIT');
    console.log('[cleanup] committed.');

    // ---- Postflight: the real orders must be untouched --------------------
    const survivors = await client.query<{ order_no: string }>(
      'SELECT order_no FROM orders WHERE order_no = ANY($1)',
      [REAL_ORDER_NOS],
    );
    if (survivors.rowCount !== REAL_ORDER_NOS.length) {
      fail(
        `postflight: expected ${REAL_ORDER_NOS.length} real orders, found ${survivors.rowCount}. Inspect backups/cleanup-mock-order-2026-09-15.json.`,
      );
    }
    console.log(
      `[cleanup] real orders intact: ${survivors.rows.map((r) => r.order_no).join(', ')}`,
    );

    const after = await client.query<{ label: string; value: string }>(
      `SELECT 'orders' AS label, COUNT(*)::text AS value FROM orders
       UNION ALL SELECT 'order_items', COUNT(*)::text FROM order_items
       UNION ALL SELECT 'open_exceptions', COUNT(*)::text FROM system_exceptions WHERE status = 'OPEN'
       UNION ALL SELECT 'total_exceptions', COUNT(*)::text FROM system_exceptions`,
    );
    console.table(after.rows);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('[cleanup] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
