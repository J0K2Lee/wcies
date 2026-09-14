/**
 * Sprint 9 post-delivery test reset (user request 2026-09-14): wipe ALL dev
 * data except login credentials so Sprint 9 features can be tested from a
 * clean slate (scheduled order sync, cancellation propagation, interception
 * STAGING, external fulfillment, T4 walkthrough).
 *
 * KEPT (hard-coded): users (login), platforms (system dictionary required to
 * create any store), migrations (TypeORM bookkeeping). Everything else in
 * schema `public` is truncated and every business sequence restarts at 1
 * (fresh ORD00000001 / EXC00000001 ...).
 *
 * Safety (AGENTS.md §89/§93):
 * - refuses NODE_ENV=production;
 * - refuses any DATABASE_URL that is not the wcies_dev database;
 * - DRY RUN by default (prints tables + row counts); pass --apply to execute;
 * - single transaction: TRUNCATE ... RESTART IDENTITY CASCADE + sequence
 *   restarts commit together or not at all;
 * - run scripts/backups via pg_dump BEFORE --apply (see docs in PR).
 *
 * Usage: tsx scripts/reset-dev-database-2026-09-14.ts [--apply]
 */
import 'dotenv/config';
import { Client } from 'pg';

/** Tables that must survive the wipe (login + system dictionary + migrations). */
const KEEP_TABLES = new Set(['users', 'platforms', 'migrations']);

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
  if (!/[?&/]wcies_dev(\?|$)/.test(connectionString) && !connectionString.includes('/wcies_dev')) {
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
      'Next steps for testing: re-create store + credential + warehouse binding,\n' +
        're-sync listings/categories manually, toggle 订单自动同步 on the store page.',
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
