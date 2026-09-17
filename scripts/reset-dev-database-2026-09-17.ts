/**
 * Sprint 10 post-delivery reset for REAL business process testing (user
 * request 2026-09-17): wipe ALL dev data so live business flows (purchase →
 * receipt → order sync → allocation → picking → shipment → settlement →
 * payout → transfer) run from a clean slate, keeping ONLY the login
 * credentials, the platform system dictionary, and the category reference
 * data.
 *
 * KEPT (hard-coded, same policy as reset-dev-database-2026-09-14):
 * - users (login), platforms (dictionary required to create any store),
 * - migrations (TypeORM bookkeeping),
 * - categories / platform_category_nodes / platform_category_mappings
 *   (user instruction 2026-09-17「保留类目树」; the OZON tree is imported ONCE
 *   and the hand-made「记住此映射」entries are unrecoverable from sync).
 * Everything else in schema `public` is truncated and every business
 * sequence restarts at 1 (fresh ORD00000001 / PO00000001 / FV000001 ...).
 * Sprint 10 finance/transfer/settlement tables are covered automatically by
 * the enumerate-all-tables approach.
 *
 * Safety (AGENTS.md §89/§93):
 * - refuses NODE_ENV=production;
 * - refuses any DATABASE_URL that is not the wcies_dev database;
 * - DRY RUN by default (prints tables + row counts); pass --apply to execute;
 * - single transaction: TRUNCATE ... RESTART IDENTITY CASCADE + sequence
 *   restarts commit together or not at all;
 * - pg_dump backup taken BEFORE --apply (backups/wcies_dev_pre_reset_20260917.sql).
 *
 * Usage: tsx scripts/reset-dev-database-2026-09-17.ts [--apply]
 */
import 'dotenv/config';
import { Client } from 'pg';

/** Tables that must survive the wipe (login + system dictionary + migrations
 *  + one-time category reference data, user instruction 2026-09-17). */
const KEEP_TABLES = new Set([
  'users',
  'platforms',
  'migrations',
  'categories',
  'platform_category_nodes',
  'platform_category_mappings',
]);

function fail(reason: string): never {
  console.error(`[reset-dev-db] ABORT: ${reason}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    fail('NODE_ENV=production - this script only ever runs against the dev database.');
  }
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === '') {
    fail('DATABASE_URL is not set.');
  }
  if (!connectionString.includes('/wcies_dev')) {
    fail(`DATABASE_URL does not point at wcies_dev: ${connectionString}`);
  }

  const apply = process.argv.includes('--apply');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const tablesResult = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const tables = tablesResult.rows
      .map((row) => row.tablename)
      .filter((name) => !KEEP_TABLES.has(name));

    const keptCounts = new Map<string, number>();
    for (const name of KEEP_TABLES) {
      const counted = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM "${name}"`,
      );
      keptCounts.set(name, Number(counted.rows[0]?.count ?? 0));
    }

    const counts: Array<{ table: string; rows: number }> = [];
    for (const table of tables) {
      const counted = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM "${table}"`,
      );
      counts.push({ table, rows: Number(counted.rows[0]?.count ?? 0) });
    }

    const sequencesResult = await client.query<{ sequencename: string }>(
      `SELECT sequencename FROM pg_sequences
        WHERE schemaname = 'public' AND sequencename NOT LIKE 'migrations%'`,
    );
    const sequences = sequencesResult.rows.map((row) => row.sequencename);

    console.log(
      `[reset-dev-db] mode=${apply ? 'APPLY' : 'DRY RUN'} database=${connectionString.replace(/:[^:@/]*@/, ':***@')}`,
    );
    console.log(`kept (hard-coded): ${[...KEEP_TABLES].join(', ')}`);
    console.table([...keptCounts.entries()].map(([table, rows]) => ({ table, rows, kept: true })));
    console.table(counts);
    console.log(`sequences to restart (${sequences.length}): ${sequences.join(', ')}`);
    const totalRows = counts.reduce((sum, entry) => sum + entry.rows, 0);
    console.log(`total rows to wipe: ${totalRows} across ${tables.length} tables`);

    if (!apply) {
      console.log('DRY RUN only - re-run with --apply to execute.');
      return;
    }

    await client.query('BEGIN');
    const quoted = tables.map((name) => `"${name}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    for (const sequence of sequences) {
      await client.query(`ALTER SEQUENCE "${sequence}" RESTART WITH 1`);
    }
    await client.query('COMMIT');
    console.log('[reset-dev-db] DONE - all listed tables truncated, sequences restarted.');
    console.log(
      'Next steps for real business testing: re-create store + credential + warehouse\n' +
        'binding, re-sync listings, then run live flows (order sync → allocation →\n' +
        'purchase → receipt → picking → shipment → finance).',
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('[reset-dev-db] failed:', error);
  process.exit(1);
});
