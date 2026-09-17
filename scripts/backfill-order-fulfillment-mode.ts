/**
 * Backfill OZON channel facts from orders.raw_data.integration_type_flow.
 * Shares the live mapper; no platform calls, no ERP/inventory changes.
 *
 * Safety: development/test NODE_ENV + exact wcies_dev database only;
 * dry run by default. Back up the target database before --apply (§89).
 * Rows are locked and updated in one transaction; errors roll everything back.
 * Usage (repo root):
 *   pnpm exec tsx scripts/backfill-order-fulfillment-mode.ts
 *   pnpm exec tsx scripts/backfill-order-fulfillment-mode.ts --apply
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { mapOzonFulfillmentMode } from '../apps/api/src/modules/integration/ozon/ozon-fulfillment-mode.mapper';

config({ path: resolve(import.meta.dirname, '../.env'), quiet: true });

function fail(message: string): never {
  console.error(JSON.stringify({ script: 'backfill-order-fulfillment-mode', error: message }));
  process.exit(1);
}

async function main(): Promise<void> {
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
    fail('Only explicit NODE_ENV=development/test is allowed; production is refused.');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail('DATABASE_URL is not set.');
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    fail('DATABASE_URL is invalid.');
  }
  // Exact pathname, not substring: /wcies_dev_production must never pass.
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/wcies_dev') {
    fail('DATABASE_URL must point at the wcies_dev database.');
  }

  const apply = process.argv.includes('--apply');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const candidates = await client.query<{
      id: string;
      fulfillment_mode: string | null;
      integration_type_flow: unknown;
    }>(`
      SELECT o.id, o.fulfillment_mode,
             o.raw_data->'integration_type_flow' AS integration_type_flow
        FROM orders o
        JOIN stores s ON s.id = o.store_id
        JOIN platforms p ON p.id = s.platform_id
       WHERE p.code = 'OZON'
         AND o.raw_data ? 'integration_type_flow'
         AND (o.fulfillment_mode IS NULL OR o.fulfillment_mode = 'FBS')
       ORDER BY o.id
       ${apply ? 'FOR UPDATE OF o' : ''}`);
    let updated = 0;
    let wouldUpdate = 0;
    let skipped = 0;
    for (const row of candidates.rows) {
      const mode = mapOzonFulfillmentMode(row.integration_type_flow);
      if (mode === null || mode === row.fulfillment_mode) {
        skipped += 1;
        continue;
      }
      if ([...mode].length > 40) {
        throw new Error('FULFILLMENT_MODE_TOO_LONG');
      }
      wouldUpdate += 1;
      if (apply) {
        const result = await client.query(
          `UPDATE orders SET fulfillment_mode = $1, updated_at = NOW() WHERE id = $2`,
          [mode, row.id],
        );
        updated += result.rowCount ?? 0;
      }
    }
    await client.query('COMMIT');
    console.log(
      JSON.stringify({
        script: 'backfill-order-fulfillment-mode',
        mode: apply ? 'APPLY' : 'DRY_RUN',
        total: candidates.rows.length,
        updated,
        wouldUpdate,
        skipped,
      }),
    );
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch(() => {
  // Never print connection strings, raw postings or driver error details.
  fail('Backfill failed; transaction rolled back if started. Check the database and fact lengths.');
});
