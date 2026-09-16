/**
 * One-off backfill (Sprint 10 T1, finance.md §2): extract platform unit
 * prices from existing order_items.raw_data (OZON posting products[].price)
 * into the structured unit_price / total_price columns added by migration
 * 20260917_001.
 *
 * Safety (AGENTS.md §89/§93):
 *   - refuses NODE_ENV=production;
 *   - DRY RUN by default, `--apply` writes;
 *   - strictly regex-guarded: only a valid <=4-decimal positive string is
 *     accepted; anything else stays NULL and is counted (never guessed);
 *   - idempotent: only touches rows where unit_price IS NULL.
 *
 * Usage:
 *   tsx scripts/backfill-order-prices.ts            # dry run
 *   tsx scripts/backfill-order-prices.ts --apply    # write
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Client } from 'pg';

config({ path: resolve(import.meta.dirname, '../.env'), quiet: true });

function fail(message: string): never {
  console.error(`[backfill-order-prices] ABORT: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (process.env.NODE_ENV === 'production') {
    fail('NODE_ENV=production - this backfill must never run against production.');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail('DATABASE_URL is not set.');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const stats = await client.query(`
      SELECT
        COUNT(*) AS total_items,
        COUNT(*) FILTER (WHERE unit_price IS NOT NULL) AS already_priced,
        COUNT(*) FILTER (WHERE unit_price IS NULL
                         AND raw_data->>'price' ~ '^\\d{1,14}(\\.\\d{1,4})?$') AS backfillable,
        COUNT(*) FILTER (WHERE unit_price IS NULL
                         AND (raw_data->>'price' IS NULL
                              OR raw_data->>'price' !~ '^\\d{1,14}(\\.\\d{1,4})?$')) AS missing
      FROM order_items`);
    const row = stats.rows[0] as {
      total_items: string;
      already_priced: string;
      backfillable: string;
      missing: string;
    };
    console.log(
      `[backfill-order-prices] items=${row.total_items} alreadyPriced=${row.already_priced} backfillable=${row.backfillable} missingPriceFact=${row.missing} mode=${apply ? 'APPLY' : 'DRY RUN'}`,
    );

    if (!apply) {
      return;
    }

    const updated = await client.query(`
      UPDATE order_items
         SET unit_price = (raw_data->>'price')::numeric(18,4),
             total_price = ROUND((raw_data->>'price')::numeric(18,4) * quantity, 4)
       WHERE unit_price IS NULL
         AND raw_data->>'price' ~ '^\\d{1,14}(\\.\\d{1,4})?$'`);
    console.log(`[backfill-order-prices] updated ${updated.rowCount} rows.`);
  } finally {
    await client.end();
  }
}

void main();
