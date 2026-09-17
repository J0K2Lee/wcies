/**
 * T0 - Yandex Market platform-fact smoke test (READ-ONLY).
 *
 * Verifies against the real Partner API what docs/integrations/yandex.md
 * lists as T0 items (§8):
 *  1. GET /v2/campaigns                       - campaign rows carry BOTH ids
 *                                              (campaignId + businessId)
 *  2. POST offer-mappings                     - page_token round-trip casing,
 *                                              marketSku presence, campaign
 *                                              publish statuses
 *  3. POST businesses/orders (updateDate)     - live status x substatus
 *                                              samples, programType values,
 *                                              paging.nextPageToken casing
 *  4. POST businesses/orders (orderIds)       - targeted re-read body
 *  5. GET campaigns/returns                   - response field names
 *  6. GET businesses/warehouses               - seller warehouse fields
 *
 * Usage: tsx scripts/yandex-t0-smoke.ts   (loads .env, dev environment only)
 * Never prints or logs credential material. All calls are reads.
 */
import 'dotenv/config';
import { createDecipheriv } from 'node:crypto';
import { Client } from 'pg';

const BASE =
  process.env.YANDEX_API_BASE_URL !== undefined && process.env.YANDEX_API_BASE_URL !== ''
    ? process.env.YANDEX_API_BASE_URL.replace(/\/+$/, '')
    : 'https://api.partner.market.yandex.ru';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (databaseUrl === undefined || keyHex === undefined) {
    throw new Error('DATABASE_URL / CREDENTIAL_ENCRYPTION_KEY missing');
  }
  const { apiKey, campaignId } = await resolveYandexToken(databaseUrl, keyHex);

  // --- 1. campaigns (identity fields) ---
  const campaigns = await get<{ campaigns?: Array<Record<string, unknown>> }>(
    '/v2/campaigns',
    apiKey,
    {},
  );
  const rows = campaigns.campaigns ?? [];
  console.log(`[campaigns] count=${rows.length}`);
  for (const row of rows.slice(0, 5)) {
    console.log(
      `[campaigns] id=${show(row.id)} businessId=${show(row.businessId)} name=${show(row.name)}`,
    );
  }

  // --- 2. offer-mappings (listings) ---
  const mappings = await post<{
    result?: {
      offerMappings?: Array<{
        offer?: {
          offerId?: string;
          cardStatus?: string;
          campaigns?: Array<{ campaignId?: unknown; status?: string }>;
        };
        mapping?: { marketSku?: unknown; marketCategoryName?: string };
      }>;
      paging?: { nextPageToken?: string };
    };
  }>(`/v2/businesses/${businessIdOf(rows, campaignId)}/offer-mappings`, apiKey, {
    query: { limit: 100 },
    body: {},
  });
  const offers = mappings.result?.offerMappings ?? [];
  let withMarketSku = 0;
  const campaignStatuses = new Map<string, number>();
  for (const offer of offers) {
    if (offer.mapping?.marketSku !== undefined && offer.mapping.marketSku !== null) {
      withMarketSku += 1;
    }
    for (const campaign of offer.offer?.campaigns ?? []) {
      const status = campaign.status ?? '(absent)';
      campaignStatuses.set(status, (campaignStatuses.get(status) ?? 0) + 1);
    }
  }
  console.log(
    `[offer-mappings] offers=${offers.length} withMarketSku=${withMarketSku} nextPageToken=${mappings.result?.paging?.nextPageToken ?? '(none)'}`,
  );
  console.log(
    `[offer-mappings] campaign status distribution: ${JSON.stringify([...campaignStatuses])}`,
  );

  // --- 3. business orders (window walk) ---
  const businessId = businessIdOf(rows, campaignId);
  const updateTo = new Date();
  const updateFrom = new Date(updateTo.getTime() - 7 * 24 * 3600 * 1000);
  const orders = await post<{
    orders?: Array<Record<string, unknown>>;
    paging?: { nextPageToken?: string };
  }>(`/v1/businesses/${encodeURIComponent(businessId)}/orders`, apiKey, {
    query: { limit: 50 },
    body: {
      dates: { updateDateFrom: updateFrom.toISOString(), updateDateTo: updateTo.toISOString() },
    },
  });
  const orderRows = orders.orders ?? [];
  const statusPairs = new Map<string, number>();
  const programTypes = new Map<string, number>();
  const orderIds: string[] = [];
  for (const order of orderRows) {
    const pair = `${show(order.status)}/${show(order.substatus)}`;
    statusPairs.set(pair, (statusPairs.get(pair) ?? 0) + 1);
    const program = show(order.programType);
    programTypes.set(program, (programTypes.get(program) ?? 0) + 1);
    if (orderIds.length < 3 && order.orderId !== undefined) {
      orderIds.push(show(order.orderId));
    }
  }
  console.log(
    `[orders] window=7d rows=${orderRows.length} nextPageToken=${orders.paging?.nextPageToken ?? '(none)'}`,
  );
  console.log(`[orders] status/substatus samples: ${JSON.stringify([...statusPairs])}`);
  console.log(`[orders] programType distribution: ${JSON.stringify([...programTypes])}`);

  // --- 4. targeted re-read by orderIds ---
  if (orderIds.length > 0) {
    const targeted = await post<{ orders?: Array<Record<string, unknown>> }>(
      `/v1/businesses/${encodeURIComponent(businessId)}/orders`,
      apiKey,
      { query: { limit: 50 }, body: { orderIds } },
    );
    console.log(`[targeted] requested=${orderIds.length} returned=${targeted.orders?.length ?? 0}`);
  }

  // --- 5. campaign returns ---
  if (campaignId !== null) {
    const returns = await get<{ returns?: Array<Record<string, unknown>> }>(
      `/v2/campaigns/${encodeURIComponent(campaignId)}/returns`,
      apiKey,
      { limit: 5 },
    );
    const returnRows = returns.returns ?? [];
    console.log(`[returns] rows=${returnRows.length}`);
    if (returnRows.length > 0) {
      console.log(`[returns] sample keys: ${Object.keys(returnRows[0] ?? {}).join(', ')}`);
    }
  }

  // --- 6. seller warehouses ---
  const warehouses = await get<{ warehouses?: Array<Record<string, unknown>> }>(
    `/v2/businesses/${encodeURIComponent(businessId)}/warehouses`,
    apiKey,
    {},
  );
  const warehouseRows = warehouses.warehouses ?? [];
  console.log(`[warehouses] rows=${warehouseRows.length}`);
  if (warehouseRows.length > 0) {
    console.log(`[warehouses] sample keys: ${Object.keys(warehouseRows[0] ?? {}).join(', ')}`);
  }
}

/** Object-safe display stringify: scalars print, anything else degrades. */
function show(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '(absent)';
  return JSON.stringify(value) ?? '(unserializable)';
}

function businessIdOf(rows: Array<Record<string, unknown>>, campaignId: string | null): string {
  if (campaignId !== null) {
    const match = rows.find((row) => String(row.id) === campaignId);
    if (match?.businessId !== undefined) {
      return show(match.businessId);
    }
  }
  const single = rows[0]?.businessId;
  if (single === undefined) {
    throw new Error('No campaign with a businessId found - check the token access');
  }
  return show(single);
}

async function resolveYandexToken(
  databaseUrl: string,
  keyHex: string,
): Promise<{ apiKey: string; campaignId: string | null }> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const rows = await client.query<{ encrypted_payload: string }>(
    `SELECT pc.encrypted_payload
     FROM platform_credentials pc
     JOIN stores s ON s.id = pc.store_id
     JOIN platforms p ON p.id = s.platform_id
     WHERE p.code = 'YANDEX' AND pc.credential_type = 'MAIN_API' AND pc.status = 'ACTIVE'
     LIMIT 1`,
  );
  await client.end();
  if (rows.rows.length === 0) {
    throw new Error('No ACTIVE YANDEX MAIN_API credential in dev DB (configure one first)');
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
  const parsed = JSON.parse(secret) as { apiKey?: unknown; campaignId?: unknown };
  if (typeof parsed.apiKey !== 'string' || parsed.apiKey === '') {
    throw new Error('YANDEX credential payload is not { apiKey, campaignId? }');
  }
  return {
    apiKey: parsed.apiKey,
    campaignId:
      typeof parsed.campaignId === 'string' && parsed.campaignId !== ''
        ? parsed.campaignId
        : typeof parsed.campaignId === 'number'
          ? String(parsed.campaignId)
          : null,
  };
}

async function get<T>(
  endpoint: string,
  apiKey: string,
  query: Record<string, string | number>,
): Promise<T> {
  const params = new URLSearchParams(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`${BASE}${endpoint}?${params.toString()}`, {
    headers: { Accept: 'application/json', 'Api-Key': apiKey },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${endpoint} -> HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  console.log(`[http] GET ${endpoint} -> ${response.status}`);
  return JSON.parse(text) as T;
}

async function post<T>(
  endpoint: string,
  apiKey: string,
  input: { query: Record<string, string | number>; body: Record<string, unknown> },
): Promise<T> {
  const params = new URLSearchParams(
    Object.entries(input.query).map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(`${BASE}${endpoint}?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Api-Key': apiKey },
    body: JSON.stringify(input.body),
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
    console.log('Yandex T0 smoke finished');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Yandex T0 smoke failed:', error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
