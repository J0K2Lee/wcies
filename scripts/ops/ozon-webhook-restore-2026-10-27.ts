/**
 * OZON 推送订阅恢复（2026-10-27 用户批准的真实平台写操作）。
 *
 * 背景：OZON 的连通性探测请求曾被打成 502，平台按 SERVER_FAULT 记账后
 * 自动暂停了订阅（docs/integrations/ozon.md §6.5）；修复接收端契约后需要把
 * 被暂停的订阅重新 enable，并把从未订阅的店铺接上。
 *
 * 模式（AGENTS.md §92：真实写必须显式 flag）：
 *   tsx scripts/ops/ozon-webhook-restore-2026-10-27.ts                # 只读盘点
 *   tsx scripts/ops/ozon-webhook-restore-2026-10-27.ts --apply        # 按清单写平台
 *   tsx scripts/ops/ozon-webhook-restore-2026-10-27.ts --apply --stores ON-002,ON-003,ON-005,ON-009
 *
 * 只操作「本店回调 URL」这一条订阅，绝不动同 Client-Id 下其它系统的 URL。
 * 写操作会补一条 operation_logs（与 OzonWebhookService.subscribe 的记录一致）。
 * 凭证解密后仅在内存使用，不打印（AGENTS.md §29）。
 */
import 'dotenv/config';
import { createDecipheriv } from 'node:crypto';
import { Client } from 'pg';

const OZON_BASE = 'https://api-seller.ozon.ru';

/** 与 apps/api/src/modules/sync/services/ozon-webhook.service.ts 保持一致。 */
const RECOMMENDED_TYPES = [
  'TYPE_NEW_POSTING',
  'TYPE_POSTING_CANCELLED',
  'TYPE_STATE_CHANGED',
  'TYPE_CREATE_ITEM',
  'TYPE_UPDATE_ITEM',
];

interface StoreRow {
  id: string;
  store_code: string;
}

interface Snapshot {
  store: string;
  url: string;
  subscriptionId: number | null;
  enabled: boolean | null;
  types: string[];
  missing: string[];
  /** 同 Client-Id 下指向「已不存在的店铺编码」的订阅（改名遗留），会占住事件类型。 */
  stale: Array<{ id: number; url: string }>;
  checkActive: boolean | null;
  checkErrors: string[];
}

/** 订阅 URL 里的店铺编码（`/stores/<code>`）；解析不到返回空串。 */
function storeCodeOfUrl(url: string): string {
  const match = /\/stores\/([^/?#]+)\/?$/.exec(url);
  return match?.[1] === undefined ? '' : decodeURIComponent(match[1]);
}

function parseArgs(): { apply: boolean; stores: string[] | null } {
  const args = process.argv.slice(2);
  const storesIndex = args.indexOf('--stores');
  const stores =
    storesIndex >= 0 && args[storesIndex + 1] !== undefined
      ? (args[storesIndex + 1] as string).split(',').map((code) => code.trim())
      : null;
  return { apply: args.includes('--apply'), stores };
}

function decryptPayload(payload: string, key: Buffer): Record<string, unknown> {
  const parsed = JSON.parse(payload) as { cipherText: string; iv: string; authTag: string };
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.authTag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(parsed.cipherText, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plain) as Record<string, unknown>;
}

/**
 * OZON notification 系列接口有限速（实测 `/v1/notification/list` 连发即 429），
 * 脚本串行 + 最小间隔 + 429 退避，避免盘点阶段就把配额打满。
 */
const MIN_INTERVAL_MS = 1_200;
let lastCallAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ozon<T>(
  auth: { clientId: string; apiKey: string },
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) {
      await sleep(wait);
    }
    lastCallAt = Date.now();
    const response = await fetch(`${OZON_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': auth.clientId,
        'Api-Key': auth.apiKey,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (response.ok) {
      return (text === '' ? {} : JSON.parse(text)) as T;
    }
    if (response.status === 429 && attempt < 3) {
      await sleep(2_000 * (attempt + 1));
      continue;
    }
    throw new Error(`${endpoint} HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  throw new Error(`${endpoint} rate limited after retries`);
}

async function main(): Promise<void> {
  const { apply, stores: only } = parseArgs();
  const databaseUrl = process.env.DATABASE_URL;
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '');
  if (databaseUrl === undefined || keyHex === undefined) {
    throw new Error('DATABASE_URL / CREDENTIAL_ENCRYPTION_KEY missing');
  }
  if (publicBaseUrl === undefined || publicBaseUrl === '') {
    throw new Error('PUBLIC_BASE_URL missing');
  }
  const key = Buffer.from(keyHex, 'hex');
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  const storeRows = await db.query<StoreRow>(
    `SELECT s.id, s.store_code
       FROM stores s JOIN platforms p ON p.id = s.platform_id
      WHERE p.code = 'OZON' AND s.status = 'ACTIVE'
      ORDER BY s.store_code`,
  );
  const targets = storeRows.rows.filter((row) => only === null || only.includes(row.store_code));
  if (only !== null && targets.length !== only.length) {
    throw new Error(
      `unknown store code(s): ${only.filter((c) => !targets.some((t) => t.store_code === c)).join(',')}`,
    );
  }

  const snapshots: Snapshot[] = [];
  const credentials = new Map<string, { clientId: string; apiKey: string }>();

  for (const store of targets) {
    const credentialRows = await db.query<{ encrypted_payload: string }>(
      `SELECT encrypted_payload FROM platform_credentials
        WHERE store_id = $1 AND credential_type = 'MAIN_API' AND status = 'ACTIVE'
        ORDER BY created_at DESC LIMIT 1`,
      [store.id],
    );
    const payloadRow = credentialRows.rows[0];
    if (payloadRow === undefined) {
      console.log(`[${store.store_code}] 没有 ACTIVE MAIN_API 凭证，跳过`);
      continue;
    }
    const credential = decryptPayload(payloadRow.encrypted_payload, key);
    // 凭证解出来是 JSON 对象：只接受字符串字段，避免把非字符串 stringify 成 [object Object]。
    const clientId = typeof credential['clientId'] === 'string' ? credential['clientId'] : '';
    const apiKey = typeof credential['apiKey'] === 'string' ? credential['apiKey'] : '';
    if (clientId === '' || apiKey === '') {
      console.log(`[${store.store_code}] 凭证缺 clientId/apiKey，跳过`);
      continue;
    }
    credentials.set(store.store_code, { clientId, apiKey });

    const url = `${publicBaseUrl}/api/v1/webhooks/ozon/stores/${store.store_code}`;
    const list = await ozon<{
      urls?: Array<{
        id: number;
        url: string;
        enable: boolean;
        types: Array<string | { type?: string }>;
      }>;
    }>({ clientId, apiKey }, '/v1/notification/list', {});
    const match = (list.urls ?? []).find((row) => row.url === url);
    const knownCodes = new Set(storeRows.rows.map((row) => row.store_code));
    const stale = (list.urls ?? [])
      .filter((row) => row.url !== url && !knownCodes.has(storeCodeOfUrl(row.url)))
      .map((row) => ({ id: row.id, url: row.url }));
    const types = (match?.types ?? [])
      .map((item) => (typeof item === 'string' ? item : item.type))
      .filter((type): type is string => typeof type === 'string' && type !== '');
    const check = await ozon<{ is_active?: boolean; errors?: Array<{ type?: string }> }>(
      { clientId, apiKey },
      '/v1/notification/check',
      { url },
    );
    snapshots.push({
      store: store.store_code,
      url,
      subscriptionId: match?.id ?? null,
      enabled: match?.enable ?? null,
      types,
      missing: RECOMMENDED_TYPES.filter((type) => !types.includes(type)),
      stale,
      checkActive: check.is_active ?? null,
      checkErrors: (check.errors ?? []).map((error) => String(error.type)),
    });
  }

  console.log('=== 盘点（只读） ===');
  for (const snapshot of snapshots) {
    console.log(
      JSON.stringify({
        store: snapshot.store,
        subscriptionId: snapshot.subscriptionId,
        enabled: snapshot.enabled,
        types: snapshot.types.length,
        missing: snapshot.missing,
        stale: snapshot.stale,
        checkActive: snapshot.checkActive,
        checkErrors: snapshot.checkErrors,
      }),
    );
  }

  const needsWork = snapshots.filter(
    (snapshot) =>
      snapshot.subscriptionId === null ||
      snapshot.enabled === false ||
      snapshot.missing.length > 0 ||
      snapshot.stale.length > 0,
  );
  console.log(`\n需要处理的店铺：${needsWork.map((s) => s.store).join(', ') || '无'}`);
  if (!apply) {
    console.log('\n（预演模式：加 --apply 才会写平台）');
    await db.end();
    return;
  }

  console.log('\n=== 执行 ===');
  for (const snapshot of needsWork) {
    const auth = credentials.get(snapshot.store);
    if (auth === undefined) {
      continue;
    }
    if (snapshot.subscriptionId === null) {
      // 改名遗留的订阅指向已不存在的店铺编码：它占住事件类型（平台回
      // "Type already in use"），且真实事件打到 404 路径必然失败。先删再建。
      for (const stale of snapshot.stale) {
        await ozon(auth, '/v1/notification/delete', { id: stale.id });
        console.log(`[${snapshot.store}] 已删除失效订阅 #${stale.id}（${stale.url}）`);
      }
      await ozon(auth, '/v1/notification/set', { url: snapshot.url, types: RECOMMENDED_TYPES });
      console.log(`[${snapshot.store}] 新建订阅（${RECOMMENDED_TYPES.length} 个事件类型）`);
    } else {
      // 事件类型已对齐时不再 update：每一次 update 都会触发平台向回调地址发 PING，
      // 而 PING 失败会被记进监控窗口，没必要为无变化的写付代价。
      if (snapshot.missing.length > 0) {
        await ozon(auth, '/v1/notification/update', {
          id: snapshot.subscriptionId,
          types: RECOMMENDED_TYPES,
        });
        console.log(`[${snapshot.store}] 事件类型已补齐：${snapshot.missing.join(', ')}`);
      }
      if (snapshot.enabled !== true) {
        await ozon(auth, '/v1/notification/enable', {
          id: snapshot.subscriptionId,
          enabled: true,
        });
        console.log(`[${snapshot.store}] 已重新 enable 订阅 #${snapshot.subscriptionId}`);
      }
    }
    const storeRow = targets.find((row) => row.store_code === snapshot.store);
    if (storeRow !== undefined) {
      await db.query(
        `INSERT INTO operation_logs
           (entity_type, entity_id, entity_code, action, operator_id, operator_name, changes)
         VALUES ('PLATFORM_WEBHOOK', $1, $2, 'SUBSCRIBE', NULL, 'ops-script:ozon-webhook-restore', $3)`,
        [
          storeRow.id,
          snapshot.store,
          JSON.stringify({
            types: {
              from: snapshot.types.length === 0 ? null : snapshot.types,
              to: RECOMMENDED_TYPES,
            },
            enabled: { from: snapshot.enabled, to: true },
          }),
        ],
      );
    }
  }

  console.log('\n=== 写后复核 ===');
  for (const snapshot of snapshots) {
    const auth = credentials.get(snapshot.store);
    if (auth === undefined) {
      continue;
    }
    const list = await ozon<{
      urls?: Array<{
        id: number;
        url: string;
        enable: boolean;
        types: Array<string | { type?: string }>;
      }>;
    }>(auth, '/v1/notification/list', {});
    const match = (list.urls ?? []).find((row) => row.url === snapshot.url);
    console.log(
      JSON.stringify({
        store: snapshot.store,
        subscriptionId: match?.id ?? null,
        enabled: match?.enable ?? null,
        typeCount: (match?.types ?? []).length,
      }),
    );
  }

  await db.end();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
