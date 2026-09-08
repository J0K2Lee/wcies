/**
 * Integration-test database bootstrap (Sprint 3 task §88-§89).
 *
 * Integration tests used to append data to the shared dev database; they now
 * run against a dedicated `wcies_test` database. This script:
 *   1. computes the test URL from DATABASE_URL (same host/credentials),
 *      refusing anything that does not end in `wcies_test` (task §89);
 *   2. creates the database when missing;
 *   3. runs all pending migrations on it (idempotent);
 *   4. seeds the admin user the tests log in with.
 *
 * Run automatically by `pnpm test:integration`.
 */
import { config } from 'dotenv';
import { Client } from 'pg';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

config({ path: ['.env', 'apps/api/.env'], quiet: true });

const TEST_DB_NAME = 'wcies_test';

function testDatabaseUrl(): string {
  const base =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://wcies:wcies_dev_password@localhost:5432/wcies_dev';
  const url = new URL(base);
  if (!url.pathname.endsWith(`/${TEST_DB_NAME}`)) {
    url.pathname = `/${TEST_DB_NAME}`;
  }
  return url.toString();
}

async function ensureDatabase(testUrl: string): Promise<void> {
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
      TEST_DB_NAME,
    ]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${TEST_DB_NAME}`);
      console.log(`[ensure-test-db] created database ${TEST_DB_NAME}`);
    }
  } finally {
    await client.end();
  }
}

async function runMigrations(testUrl: string): Promise<void> {
  process.env.DATABASE_URL = testUrl;
  const dataSource = (await import('../apps/api/src/database/datasource')).default;
  await dataSource.initialize();
  try {
    const applied = await dataSource.runMigrations();
    console.log(`[ensure-test-db] migrations: ${applied.length} newly applied`);
  } finally {
    await dataSource.destroy();
  }
}

async function seedAdmin(testUrl: string): Promise<void> {
  // Reuse the api package's dev seeders (argon2 etc. live in apps/api's deps):
  // admin user + Sprint 1 acceptance fixtures (legacy suites reference them).
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const root = resolve(import.meta.dirname, '..');
  for (const script of ['seed:dev', 'seed:sprint1']) {
    execFileSync(pnpm, ['--filter', '@wcies/api', 'run', script], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
  console.log(`[ensure-test-db] admin + sprint1 seed ready`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ensure-test-db must never run against production (task §89).');
  }
  const testUrl = testDatabaseUrl();
  if (!testUrl.includes(`/${TEST_DB_NAME}`)) {
    throw new Error(`Refusing to bootstrap a non-test database: ${testUrl}`);
  }
  await ensureDatabase(testUrl);
  await runMigrations(testUrl);
  await seedAdmin(testUrl);
  console.log(`[ensure-test-db] ${TEST_DB_NAME} ready`);
}

main().catch((error: unknown) => {
  console.error('[ensure-test-db] FAILED:', error);
  process.exit(1);
});
