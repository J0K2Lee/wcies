/**
 * T0 - WB webhook 校准脚本（docs/integrations/wildberries.md §5b 的三个校准项）。
 *
 * 校准目标：
 *  1. 事件目录现状 —— GET /api/v1/event-scopes（订单类事件是否上线）
 *  2. secret 字段名 —— 创建响应的顶层键名（文档未写明；实现按 /secret/i 扫描）
 *  3. 真实投递样例 —— test/send 触发一封投递，落库后查 external_raw_events
 *
 * 模式（默认只读；真实写操作必须显式加 flag —— AGENTS.md §92）：
 *  tsx scripts/wb-webhook-t0.ts                        # 只读：事件目录 + webhook 列表
 *  tsx scripts/wb-webhook-t0.ts --create --store WB-A  # 真实写：创建订阅 + secret 落库
 *  tsx scripts/wb-webhook-t0.ts --test-send --store WB-A # 真实写：发送测试事件
 *
 * 安全：secret 值【永不打印】——创建响应只输出键名与命中 /secret/i 的字段名；
 * secret 通过 AES-256-GCM（CREDENTIAL_ENCRYPTION_KEY）加密写入店铺 WEBHOOK
 * 凭证，与 PlatformCredentialService 的落库格式一致。
 *
 * 需要：dev 库中该 WB 店铺已配置 ACTIVE MAIN_API 凭证（seller token）、
 * .env 的 WB_WEBHOOKS_SERVICE_SECRET（服务密钥）、PUBLIC_BASE_URL（--create 时）。
 */
import 'dotenv/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Client } from 'pg';

const BASE = 'https://webhooks-api.wildberries.ru';
const WEBHOOK_RATE_FLOOR_MS = 1_100; // webhook API 全方法共限 1 req/s

interface Options {
  create: boolean;
  testSend: boolean;
  storeCode: string;
}

/** Object-safe display stringify: scalars print, anything else degrades. */
function show(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '?';
  return JSON.stringify(value);
}

async function main(): Promise<void> {
  const options = parseArgs();
  const databaseUrl = process.env.DATABASE_URL;
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  const serviceSecret = process.env.WB_WEBHOOKS_SERVICE_SECRET;
  if (databaseUrl === undefined || keyHex === undefined) {
    throw new Error('DATABASE_URL / CREDENTIAL_ENCRYPTION_KEY missing');
  }
  if (serviceSecret === undefined || serviceSecret === '') {
    throw new Error('WB_WEBHOOKS_SERVICE_SECRET missing (.env)');
  }
  const { apiKey, store } = await resolveStore(databaseUrl, keyHex, options.storeCode);
  const auth = { apiKey, serviceSecret };

  // --- 1. 事件目录（只读）：订单类事件是否上线 ---
  const scopes = await call<{ [key: string]: unknown }>(auth, 'GET', '/api/v1/event-scopes');
  console.log('[event-scopes] top-level keys:', Object.keys(scopes).join(', '));
  console.log('[event-scopes]', JSON.stringify(scopes, null, 2).slice(0, 3000));

  // --- 2. 现有 webhook 列表（只读）：列表响应形态 ---
  const list = await call<unknown>(auth, 'GET', '/api/v1/webhooks');
  const rows = extractRows(list);
  console.log(`[webhooks] count=${rows.length}`);
  for (const row of rows) {
    const id = row['id'];
    const url = row['url'];
    console.log(
      `[webhooks] id=${String(id)} url=${typeof url === 'string' ? url : '?'}`,
      `enabled=${String(row['enabled'])}`,
    );
  }
  console.log(
    '[webhooks] first-row top-level keys:',
    rows.length > 0 ? Object.keys(rows[0] as object).join(', ') : '(empty)',
  );

  if (!options.create && !options.testSend) {
    console.log('只读探测完成。--create 建订阅 / --test-send 触发投递（均为真实写操作）。');
    return;
  }

  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '');
  if (publicBaseUrl === undefined || publicBaseUrl === '') {
    throw new Error('PUBLIC_BASE_URL missing (.env) —— 无法生成回调 URL');
  }
  const callbackUrl = `${publicBaseUrl}/api/v1/webhooks/wb/stores/${store.storeCode}`;

  // --- 3. --test-send：对已存在的 webhook 发测试事件 ---
  if (options.testSend) {
    const target = rows.find((row) => row['url'] === callbackUrl) ?? rows[0];
    const id = target === undefined ? undefined : target['id'];
    if (id === undefined) {
      throw new Error('没有可用的 webhook（先 --create）');
    }
    const webhookId = show(id);
    await sleep(WEBHOOK_RATE_FLOOR_MS);
    await call<unknown>(
      auth,
      'POST',
      `/api/v1/webhooks/${encodeURIComponent(webhookId)}/test/send`,
      {},
    );
    console.log(`[test-send] webhook ${webhookId} 测试事件已发送，等待投递...`);
    await sleep(5_000);
    await printLatestRawEvents(databaseUrl, store.id);
    return;
  }

  // --- 4. --create：真实订阅 + secret 加密落库 ---
  const existing = rows.find((row) => row['url'] === callbackUrl);
  if (existing !== undefined) {
    throw new Error(
      `该 URL 已订阅（webhook ${show(existing['id'])}）。若本地无 secret，请在 WB 侧删除后重试。`,
    );
  }
  console.log(`[create] ⚠ 即将向真实 WB 平台创建 webhook：${callbackUrl}`);
  await sleep(WEBHOOK_RATE_FLOOR_MS);
  const created = await call<Record<string, unknown>>(auth, 'POST', '/api/v1/webhooks', {
    enabled: true,
    url: callbackUrl,
    name: `WCIES ${store.storeCode}`.slice(0, 60),
    subscriptions: [
      { scope: 'content', event: 'card_changed' },
      { scope: 'content', event: 'card_creation_error' },
    ],
  });

  // 校准项：只打印键名，绝不打印值（secret 只此一次，打印即泄露）。
  console.log('[create] 响应顶层键名（校准项①，只列名不列值）:', Object.keys(created).join(', '));
  const secretKey = Object.keys(created).find(
    (key) => /secret/i.test(key) && typeof created[key] === 'string' && created[key] !== '',
  );
  if (secretKey === undefined) {
    // 一层嵌套再找一次；仍找不到就把键名树打出来供改 extractWebhookSecret。
    const nested = Object.entries(created).find(
      ([, value]) =>
        typeof value === 'object' &&
        value !== null &&
        Object.keys(value).some((k) => /secret/i.test(k)),
    );
    if (nested !== undefined) {
      const nestedKeys = Object.keys(nested[1] as object);
      console.log(
        `[create] secret 位于嵌套对象 "${nested[0]}" 内，其键名: ${nestedKeys.join(', ')}`,
      );
      await persistSecret(databaseUrl, keyHex, store, digSecret(nested[1]), created);
    } else {
      console.log(
        '[create] ⚠ 未找到 /secret/i 字段 —— 请把上面的键名列表同步给 extractWebhookSecret 的维护者',
      );
      console.log('[create] 该 webhook 已在 WB 侧创建但无法找回 secret，请到 WB 侧删除后重试');
    }
    return;
  }
  console.log(`[create] secret 字段名 = "${secretKey}"（值已隐藏）`);
  await persistSecret(databaseUrl, keyHex, store, String(created[secretKey]), created);
  console.log('[create] 订阅完成。下一步：--test-send 触发真实投递样例。');
}

function digSecret(value: unknown): string {
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (/secret/i.test(key) && typeof inner === 'string' && inner !== '') {
      return inner;
    }
  }
  throw new Error('nested secret scan failed');
}

async function persistSecret(
  databaseUrl: string,
  keyHex: string,
  store: { id: string; storeCode: string },
  secret: string,
  created: Record<string, unknown>,
): Promise<void> {
  const encrypted = await encryptPayload(keyHex, JSON.stringify({ secret }));
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(
    `INSERT INTO platform_credentials (store_id, credential_type, encrypted_payload, status)
     VALUES ($1, 'WEBHOOK', $2, 'ACTIVE')
     ON CONFLICT (store_id, credential_type)
     DO UPDATE SET encrypted_payload = $2, status = 'ACTIVE', updated_at = now()`,
    [store.id, JSON.stringify(encrypted)],
  );
  await client.end();
  console.log(
    `[persist] WEBHOOK 凭证已加密落库（store=${store.storeCode}, webhook id=${show(created['id'])}）`,
  );
}

/** 与 PlatformCredentialService 相同的 AES-256-GCM 信封格式。 */
async function encryptPayload(
  keyHex: string,
  plaintext: string,
): Promise<{ cipherText: string; iv: string; authTag: string }> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const cipherText = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    cipherText: cipherText.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

async function printLatestRawEvents(databaseUrl: string, storeId: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const result = await client.query<{
    received_at: Date;
    event_type: string;
    status: string;
    external_event_id: string | null;
    payload: unknown;
  }>(
    `SELECT event_type, external_event_id, status, payload, received_at
     FROM external_raw_events
     WHERE store_id = $1 AND platform = 'WB'
     ORDER BY received_at DESC LIMIT 3`,
    [storeId],
  );
  await client.end();
  console.log(`[raw-events] 最近 ${result.rows.length} 条 WB 事件：`);
  for (const row of result.rows) {
    console.log(
      `[raw-events] ${show(row.received_at)} type=${show(row.event_type)} status=${show(row.status)} externalId=${show(row.external_event_id)}`,
    );
    console.log('[raw-events] payload:', JSON.stringify(row.payload).slice(0, 1200));
  }
}

function extractRows(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) {
    return body as Array<Record<string, unknown>>;
  }
  if (typeof body === 'object' && body !== null) {
    for (const key of ['webhooks', 'data', 'items']) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value as Array<Record<string, unknown>>;
      }
    }
  }
  return [];
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  return {
    create: args.includes('--create'),
    testSend: args.includes('--test-send'),
    storeCode: args.includes('--store') ? String(args[args.indexOf('--store') + 1]) : 'WB-A',
  };
}

async function resolveStore(
  databaseUrl: string,
  keyHex: string,
  storeCode: string,
): Promise<{ apiKey: string; store: { id: string; storeCode: string } }> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const storeRows = await client.query<{ id: string; store_code: string }>(
    `SELECT s.id, s.store_code
     FROM stores s JOIN platforms p ON p.id = s.platform_id
     WHERE p.code = 'WB' AND ($1 = '' OR s.store_code = $1)
     ORDER BY s.store_code LIMIT 1`,
    [storeCode],
  );
  if (storeRows.rows.length === 0) {
    await client.end();
    throw new Error(`No WB store found (storeCode=${storeCode})`);
  }
  const credRows = await client.query<{ encrypted_payload: string }>(
    `SELECT pc.encrypted_payload
     FROM platform_credentials pc
     WHERE pc.store_id = $1 AND pc.credential_type = 'MAIN_API' AND pc.status = 'ACTIVE'
     LIMIT 1`,
    [storeRows.rows[0].id],
  );
  await client.end();
  if (credRows.rows.length === 0) {
    throw new Error('该 WB 店铺没有 ACTIVE MAIN_API 凭证（先在店铺管理页配置 seller token）');
  }
  const apiKey = await decryptPayloadToApiKey(keyHex, credRows.rows[0].encrypted_payload);
  return {
    apiKey,
    store: { id: storeRows.rows[0].id, storeCode: storeRows.rows[0].store_code },
  };
}

async function decryptPayloadToApiKey(keyHex: string, encryptedPayload: string): Promise<string> {
  const payload = JSON.parse(encryptedPayload) as {
    cipherText: string;
    iv: string;
    authTag: string;
  };
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const secret = Buffer.concat([
    decipher.update(Buffer.from(payload.cipherText, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  const parsed = JSON.parse(secret) as { apiKey?: unknown };
  if (typeof parsed.apiKey !== 'string' || parsed.apiKey === '') {
    throw new Error('MAIN_API payload is not { apiKey }');
  }
  return parsed.apiKey;
}

async function call<T>(
  auth: { apiKey: string; serviceSecret: string },
  method: 'GET' | 'POST',
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: auth.apiKey,
      'X-Client-Secret': auth.serviceSecret,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${endpoint} -> HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  console.log(`[http] ${method} ${endpoint} -> ${response.status}`);
  return (text.trim() === '' ? {} : JSON.parse(text)) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main()
  .then(() => {
    console.log('WB webhook T0 finished');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('WB webhook T0 failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
