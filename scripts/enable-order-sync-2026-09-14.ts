/**
 * Sprint 9 T2 data setup (planning decision 2): opt the dev database's only
 * active store ON-002 into scheduled ORDER_SYNC by writing
 * settings.sync.orderSyncEnabled = true (listing stays manual-only).
 *
 * This is a DEVELOPMENT DATA setting, not a business rule (planning §3 T2.2).
 * - refuses to run when NODE_ENV=production;
 * - read-modify-write: never touches other settings keys;
 * - idempotent: re-running keeps the same value;
 * - prints before/after for the record.
 *
 * Usage: tsx scripts/enable-order-sync-2026-09-14.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

const STORE_CODE = 'ON-002';

function fail(reason: string): never {
  console.error(`[enable-order-sync] ABORT: ${reason}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    fail('NODE_ENV=production - this is a development-data script.');
  }
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === '') {
    fail('DATABASE_URL is not set.');
  }
  if (!/wcies_dev/.test(connectionString)) {
    fail(
      `DATABASE_URL does not point at the dev database (expected wcies_dev): ${connectionString}`,
    );
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<{
      id: string;
      store_code: string;
      name: string;
      status: string;
      settings: Record<string, unknown> | null;
    }>(
      `SELECT id, store_code, name, status, settings FROM stores WHERE store_code = $1 FOR UPDATE`,
      [STORE_CODE],
    );
    if (found.rowCount !== 1) {
      fail(`expected exactly one store ${STORE_CODE}, found ${found.rowCount ?? 0}`);
    }
    const store = found.rows[0]!;
    if (store.status !== 'ACTIVE') {
      fail(`store ${STORE_CODE} is ${store.status}, not ACTIVE`);
    }
    const before = store.settings ?? {};
    const syncBefore = (before['sync'] as Record<string, unknown> | undefined) ?? undefined;
    const after = {
      ...before,
      sync: {
        orderSyncEnabled: true,
        listingSyncEnabled: syncBefore?.['listingSyncEnabled'] === true,
      },
    };
    await client.query(`UPDATE stores SET settings = $2, updated_at = now() WHERE id = $1`, [
      store.id,
      JSON.stringify(after),
    ]);
    await client.query('COMMIT');
    console.log('[enable-order-sync] OK');
    console.table([
      {
        store: `${store.store_code} (${store.name})`,
        syncBefore: JSON.stringify(syncBefore ?? null),
        syncAfter: JSON.stringify(after.sync),
      },
    ]);
    console.log(
      'NOTE: the api-dev container must be recreated to pick up\n' +
        'ORDER_SYNC_INTERVAL_SECONDS=300 from docker-compose (docker compose --profile dev up -d api-dev).',
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('[enable-order-sync] failed:', error);
  process.exit(1);
});
