/**
 * One-off test-residue cleanup (Sprint 9 planning decision 7, 2026-09-14).
 *
 * Removes exactly two leftovers of wiped development test scenes:
 *   A. the orphan exception `EXC00000010` - it points at an interception
 *      (`ITC00000004`, order ORD00000040) and an order item that no longer
 *      exist, while the inventory ledger shows no picked stock;
 *   B. the synthetic ingest test order `ORD00000048` (platform_order_id
 *      `MOCK-D-001`, platform_sku_id `NO-SUCH-MAPPING`, no backing listing)
 *      together with its line, its status history and its exceptions.
 *
 * Both were confirmed as test data by the user in the Sprint 9 planning review
 * (`docs/WCIES_下一阶段规划_Sprint_9_订单状态同步与运营闭环.md` §5 决策 7).
 *
 * Safety (AGENTS.md §89/§93):
 *   - refuses to run when NODE_ENV=production;
 *   - DRY RUN by default - pass `--apply` to delete;
 *   - targets are hard-coded by business key; nothing is matched by pattern;
 *   - preflight assertions fail loudly when reality differs from the recorded
 *     evidence, so a re-run on a changed database does nothing destructive;
 *   - every delete happens in ONE transaction, printing before/after counts.
 *
 * Usage:
 *   tsx scripts/cleanup-test-residue-2026-09-14.ts            # dry run
 *   tsx scripts/cleanup-test-residue-2026-09-14.ts --apply    # execute
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Client } from 'pg';

config({ path: resolve(import.meta.dirname, '../.env'), quiet: true });

/** The two authorized targets, by business key (never by pattern). */
const ORPHAN_EXCEPTION_NO = 'EXC00000010';
const TEST_ORDER_NO = 'ORD00000048';
const TEST_ORDER_PLATFORM_ID = 'MOCK-D-001';

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
  console.log(`[cleanup] mode: ${apply ? 'APPLY (deletes rows)' : 'DRY RUN (no writes)'}`);

  try {
    // ---- Preflight: the evidence the decision was based on -----------------
    const order = (
      await client.query<{
        id: string;
        platform_order_id: string;
        erp_status: string;
        platform_status: string | null;
      }>(
        `SELECT id, platform_order_id, erp_status, platform_status
           FROM orders WHERE order_no = $1`,
        [TEST_ORDER_NO],
      )
    ).rows[0];
    if (order === undefined) {
      console.log(`[cleanup] ${TEST_ORDER_NO} not found - nothing to do for target B.`);
    } else if (order.platform_order_id !== TEST_ORDER_PLATFORM_ID) {
      fail(
        `${TEST_ORDER_NO} carries platform_order_id=${order.platform_order_id}, expected ${TEST_ORDER_PLATFORM_ID}.`,
      );
    }

    const orphanException = (
      await client.query<{ id: string; reference_id: string }>(
        `SELECT id, reference_id FROM system_exceptions WHERE exception_no = $1`,
        [ORPHAN_EXCEPTION_NO],
      )
    ).rows[0];
    if (orphanException !== undefined) {
      const interception = await client.query('SELECT 1 FROM order_interceptions WHERE id = $1', [
        orphanException.reference_id,
      ]);
      if (interception.rowCount !== 0) {
        fail(
          `${ORPHAN_EXCEPTION_NO} now has a live interception - the "orphan" premise no longer holds.`,
        );
      }
    } else {
      console.log(`[cleanup] ${ORPHAN_EXCEPTION_NO} not found - nothing to do for target A.`);
    }

    if (order !== undefined) {
      const blocking = (
        await client.query<{
          items: string;
          picking: string;
          shipments: string;
          interceptions: string;
        }>(
          `SELECT
             (SELECT COUNT(*) FROM order_items WHERE order_id = $1)::text AS items,
             (SELECT COUNT(*) FROM picking_task_items WHERE order_id = $1)::text AS picking,
             (SELECT COUNT(*) FROM shipments WHERE order_id = $1)::text AS shipments,
             (SELECT COUNT(*) FROM order_interceptions WHERE order_id = $1)::text AS interceptions`,
          [order.id],
        )
      ).rows[0];
      console.log(`[cleanup] ${TEST_ORDER_NO} children: ${JSON.stringify(blocking)}`);
      if (blocking !== undefined && (blocking.picking !== '0' || blocking.shipments !== '0')) {
        fail(`${TEST_ORDER_NO} has picking/shipment rows - it is not a plain ingest test.`);
      }
    }

    // ---- Dry run: show exactly what would go ------------------------------
    const itemIds =
      order === undefined
        ? []
        : (
            await client.query<{ id: string }>('SELECT id FROM order_items WHERE order_id = $1', [
              order.id,
            ])
          ).rows.map((row) => row.id);

    const preview = await client.query<{ table_name: string; rows: string }>(
      `SELECT 'orders' AS table_name, COUNT(*)::text AS rows FROM orders WHERE id = $1
       UNION ALL SELECT 'order_status_history', COUNT(*)::text FROM order_status_history WHERE order_id = $1
       UNION ALL SELECT 'order_items', COUNT(*)::text FROM order_items WHERE order_id = $1
       UNION ALL SELECT 'system_exceptions(by item)', COUNT(*)::text FROM system_exceptions WHERE reference_id = ANY($2::uuid[])
       UNION ALL SELECT 'system_exceptions(orphan)', COUNT(*)::text FROM system_exceptions WHERE exception_no = $3
       UNION ALL SELECT 'notification(orphan, NOT deleted)', COUNT(*)::text
         FROM notifications n WHERE n.reference_type = 'ORDER_INTERCEPTION'
           AND NOT EXISTS (SELECT 1 FROM order_interceptions i WHERE i.id = n.reference_id)`,
      [order?.id ?? null, itemIds, ORPHAN_EXCEPTION_NO],
    );
    console.table(preview.rows);

    if (order === undefined && orphanException === undefined) {
      console.log('[cleanup] both targets are already gone - nothing to do.');
      return;
    }
    if (!apply) {
      console.log('[cleanup] dry run complete. Re-run with --apply to delete the rows above.');
      return;
    }

    // ---- Apply: one transaction, FK-safe order ----------------------------
    await client.query('BEGIN');
    if (order !== undefined) {
      await client.query('DELETE FROM order_status_history WHERE order_id = $1', [order.id]);
      await client.query('DELETE FROM system_exceptions WHERE reference_id = ANY($1::uuid[])', [
        itemIds,
      ]);
      await client.query('DELETE FROM order_items WHERE order_id = $1', [order.id]);
      await client.query('DELETE FROM orders WHERE id = $1', [order.id]);
    }
    await client.query('DELETE FROM system_exceptions WHERE exception_no = $1', [
      ORPHAN_EXCEPTION_NO,
    ]);
    await client.query('COMMIT');
    console.log('[cleanup] committed.');

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
