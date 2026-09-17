/**
 * T0 - Wildberries platform-fact smoke test (READ-ONLY).
 *
 * Verifies against the real API what docs/integrations/wildberries.md lists
 * as T0 items (§8):
 *  1. GET common /api/v1/seller-info   - credential validation response shape
 *  2. POST content cards/list          - cursor round-trip, skus barcodes,
 *                                        pagination termination
 *  3. GET marketplace /api/v3/orders   - `next` cursor semantics, 30-day
 *                                        window, live wbStatus value set
 *  4. GET statistics supplier/orders   - lastChangeDate cursor, MSK (+03:00)
 *                                        timestamps, incremental behavior
 *
 * Usage: tsx scripts/wb-t0-smoke.ts   (loads .env, dev environment only)
 * Never prints or logs credential material. All calls are reads.
 */
import 'dotenv/config';
import { createDecipheriv } from 'node:crypto';
import { Client } from 'pg';

const BASES = {
  common: envBaseUrl('WB_COMMON_API_BASE_URL', 'https://common-api.wildberries.ru'),
  content: envBaseUrl('WB_CONTENT_API_BASE_URL', 'https://content-api.wildberries.ru'),
  marketplace: envBaseUrl('WB_MARKETPLACE_API_BASE_URL', 'https://marketplace-api.wildberries.ru'),
  statistics: envBaseUrl('WB_STATISTICS_API_BASE_URL', 'https://statistics-api.wildberries.ru'),
} as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (databaseUrl === undefined || keyHex === undefined) {
    throw new Error('DATABASE_URL / CREDENTIAL_ENCRYPTION_KEY missing');
  }
  const apiKey = await resolveWbToken(databaseUrl, keyHex);

  // --- 1. seller-info (credential validation) ---
  const seller = await get<{ [key: string]: unknown }>(
    BASES.common,
    '/api/v1/seller-info',
    apiKey,
    {},
  );
  console.log('[seller-info] top-level keys:', Object.keys(seller).join(', '));

  // --- 2. cards/list (listings) ---
  let cursor: { updatedAt: number; nmID: number } = { updatedAt: 0, nmID: 0 };
  let page = 0;
  let totalCards = 0;
  const barcodeStats = new Map<string, number>();
  for (; page < 3; page += 1) {
    const body = await post<{
      data?: {
        cards?: Array<{
          nmID: number;
          vendorCode?: string;
          sizes?: Array<{ chrtID?: number; skus?: number[] }>;
        }>;
        cursor?: { total?: number; updatedAt?: number; nmID?: number };
      };
      error?: boolean;
      errorText?: string;
    }>(BASES.content, '/content/v2/get/cards/list', apiKey, {
      settings: { filter: {}, cursor: { ...cursor, limit: 100 }, sort: { ascending: true } },
    });
    if (body.error === true) {
      throw new Error(`cards/list business error: ${body.errorText ?? '(no errorText)'}`);
    }
    const cards = body.data?.cards ?? [];
    totalCards += cards.length;
    for (const card of cards) {
      const barcodeCount = (card.sizes ?? []).reduce(
        (sum, size) => sum + (size.skus?.length ?? 0),
        0,
      );
      barcodeStats.set(String(barcodeCount), (barcodeStats.get(String(barcodeCount)) ?? 0) + 1);
    }
    const next = body.data?.cursor;
    console.log(`[cards] page=${page + 1} cards=${cards.length} cursor=${JSON.stringify(next)}`);
    if (cards.length < 100 || next?.nmID === undefined || next.nmID === cursor.nmID) {
      break; // short page OR cursor without progress = done
    }
    cursor = { updatedAt: next.updatedAt ?? 0, nmID: next.nmID };
  }
  console.log(
    `[cards] total_sampled=${totalCards} barcodes-per-card distribution: ${JSON.stringify([...barcodeStats])}`,
  );

  // --- 3. marketplace v3 orders (FBS/DBS) ---
  const to = Math.floor(Date.now() / 1000);
  const from = to - 7 * 24 * 3600;
  const v3 = await get<{ orders?: Array<{ [key: string]: unknown }>; next?: number }>(
    BASES.marketplace,
    '/api/v3/orders',
    apiKey,
    { dateFrom: from, dateTo: to, next: 0, limit: 1000 },
  );
  const orders = v3.orders ?? [];
  const wbStatuses = new Map<string, number>();
  const supplierStatuses = new Map<string, number>();
  for (const order of orders) {
    for (const [map, key] of [
      [wbStatuses, 'wbStatus'],
      [supplierStatuses, 'supplierStatus'],
    ] as const) {
      const value = order[key];
      const label = typeof value === 'string' && value !== '' ? value : '(absent)';
      map.set(label, (map.get(label) ?? 0) + 1);
    }
  }
  console.log(
    `[v3-orders] window=7d orders=${orders.length} next=${v3.next ?? '(absent)'} (0/absent = exhausted per our adapter)`,
  );
  console.log(`[v3-orders] wbStatus distribution: ${JSON.stringify([...wbStatuses])}`);
  console.log(`[v3-orders] supplierStatus distribution: ${JSON.stringify([...supplierStatuses])}`);
  const sample = orders[0];
  if (sample !== undefined) {
    console.log(`[v3-orders] sample top-level keys: ${Object.keys(sample).join(', ')}`);
  }

  // --- 4. statistics supplier/orders (DBW rows) ---
  const mskFrom = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace('Z', '+03:00');
  const stats = await get<Array<{ [key: string]: unknown }>>(
    BASES.statistics,
    '/api/v1/supplier/orders',
    apiKey,
    { dateFrom: mskFrom, flag: 0 },
  );
  const rows = Array.isArray(stats) ? stats : [];
  const lastChange = rows.length > 0 ? String(rows[rows.length - 1]?.lastChangeDate) : '(empty)';
  console.log(
    `[stats-orders] dateFrom=${mskFrom} rows=${rows.length} (1 req/min - single probe only)`,
  );
  console.log(`[stats-orders] last row lastChangeDate=${lastChange} (next incremental cursor)`);
  if (rows.length > 0) {
    console.log(`[stats-orders] sample keys: ${Object.keys(rows[0] ?? {}).join(', ')}`);
  }
}

function envBaseUrl(key: string, fallback: string): string {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value.replace(/\/+$/, '') : fallback;
}

async function resolveWbToken(databaseUrl: string, keyHex: string): Promise<string> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const rows = await client.query<{ encrypted_payload: string }>(
    `SELECT pc.encrypted_payload
     FROM platform_credentials pc
     JOIN stores s ON s.id = pc.store_id
     JOIN platforms p ON p.id = s.platform_id
     WHERE p.code = 'WB' AND pc.credential_type = 'MAIN_API' AND pc.status = 'ACTIVE'
     LIMIT 1`,
  );
  await client.end();
  if (rows.rows.length === 0) {
    throw new Error('No ACTIVE WB MAIN_API credential in dev DB (configure one first)');
  }
  const payload = JSON.parse(rows.rows[0].encrypted_payload) as {
    cipherText: string;
    iv: string;
    authTag: string;
  };
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const secret = Buffer.concat([
    decipher.update(Buffer.from(payload.cipherText, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  const parsed = JSON.parse(secret) as { apiKey?: unknown };
  if (typeof parsed.apiKey !== 'string' || parsed.apiKey === '') {
    throw new Error('WB credential payload is not { apiKey }');
  }
  return parsed.apiKey;
}

async function get<T>(
  base: string,
  endpoint: string,
  apiKey: string,
  query: Record<string, string | number>,
): Promise<T> {
  const params = new URLSearchParams(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`${base}${endpoint}?${params.toString()}`, {
    headers: { Accept: 'application/json', Authorization: apiKey },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${endpoint} -> HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  console.log(`[http] GET ${endpoint} -> ${response.status}`);
  return JSON.parse(text) as T;
}

async function post<T>(
  base: string,
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${endpoint} -> HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  console.log(`[http] POST ${endpoint} -> ${response.status}`);
  return JSON.parse(text) as T;
}

main()
  .then(() => {
    console.log('WB T0 smoke finished');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('WB T0 smoke failed:', error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
