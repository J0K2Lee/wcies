/**
 * Sprint 8.5 T0 - OZON platform-fact smoke test (READ-ONLY).
 *
 * Verifies against the real Seller API what the OpenAPI spec only promises:
 *  1. /v1/description-category/tree with language=ZH_HANS - Chinese quality,
 *     node totals, depth distribution, disabled share.
 *  2. Same tree with language=RU - bilingual merge feasibility.
 *  3. /v4/product/info/attributes - real response shape and the actual
 *     dimension_unit / weight_unit values for a sample of own products.
 *
 * Usage: tsx scripts/ozon-t0-smoke.ts   (loads .env, dev environment only)
 * Never prints or logs credential material.
 */
import 'dotenv/config';
import { createDecipheriv } from 'node:crypto';
import { Client } from 'pg';

interface TreeNode {
  description_category_id?: number;
  category_name?: string;
  children?: TreeNode[];
  disabled?: boolean;
  type_id?: number;
  type_name?: string;
}

interface V4AttributesItem {
  product_id?: number;
  offer_id?: string;
  depth?: number;
  height?: number;
  width?: number;
  dimension_unit?: string;
  weight?: number;
  weight_unit?: string;
  attributes?: unknown;
}

const BASE_URL = 'https://api-seller.ozon.ru';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (databaseUrl === undefined || keyHex === undefined) {
    throw new Error('DATABASE_URL / CREDENTIAL_ENCRYPTION_KEY missing');
  }
  const auth = await resolveOzonAuth(databaseUrl, keyHex ?? '');

  // --- 1. Tree ZH_HANS ---
  const zh = await call<TreeNode[]>(auth, '/v1/description-category/tree', {
    language: 'ZH_HANS',
  });
  reportTree('ZH_HANS', zh);

  // --- 2. Tree RU (merge feasibility: id sets must match) ---
  const ru = await call<TreeNode[]>(auth, '/v1/description-category/tree', { language: 'RU' });
  reportTree('RU', ru);
  const zhTypes = collectTypeKeys(zh);
  const ruTypes = collectTypeKeys(ru);
  const onlyZh = [...zhTypes].filter((id) => !ruTypes.has(id));
  const onlyRu = [...ruTypes].filter((id) => !zhTypes.has(id));
  console.log(
    `[merge] type keys: zh=${zhTypes.size} ru=${ruTypes.size} onlyZh=${onlyZh.length} onlyRu=${onlyRu.length}`,
  );

  // --- 3. v4 attributes for up to 10 real products ---
  const productIds = await queryProductSample(databaseUrl);
  const v4 = await call<{ items?: V4AttributesItem[]; total?: number; last_id?: string }>(
    auth,
    '/v4/product/info/attributes',
    {
      filter: { product_id: productIds },
      limit: 1000,
    },
  );
  const items = v4.items ?? [];
  console.log(`[v4] total=${v4.total ?? '?'} returned=${items.length} last_id=${v4.last_id ?? ''}`);
  const dimensionUnits = new Map<string, number>();
  const weightUnits = new Map<string, number>();
  for (const item of items) {
    const du = item.dimension_unit ?? '(absent)';
    const wu = item.weight_unit ?? '(absent)';
    dimensionUnits.set(du, (dimensionUnits.get(du) ?? 0) + 1);
    weightUnits.set(wu, (weightUnits.get(wu) ?? 0) + 1);
    console.log(
      `[v4] product=${item.product_id} offer=${item.offer_id} ${item.depth}x${item.width}x${item.height}${item.dimension_unit ?? ''} weight=${item.weight}${item.weight_unit ?? ''} hasAttributes=${Array.isArray(item.attributes)}`,
    );
  }
  console.log(`[v4] dimension_unit distribution: ${JSON.stringify([...dimensionUnits])}`);
  console.log(`[v4] weight_unit distribution: ${JSON.stringify([...weightUnits])}`);
}

async function resolveOzonAuth(
  databaseUrl: string,
  keyHex: string,
): Promise<{ clientId: string; apiKey: string }> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const rows = await client.query<{ encrypted_payload: string }>(
    `SELECT pc.encrypted_payload
     FROM platform_credentials pc
     JOIN stores s ON s.id = pc.store_id
     JOIN platforms p ON p.id = s.platform_id
     WHERE p.code = 'OZON' AND pc.credential_type = 'MAIN_API' AND pc.status = 'ACTIVE'
     LIMIT 1`,
  );
  await client.end();
  if (rows.rows.length === 0) {
    throw new Error('No ACTIVE OZON MAIN_API credential in dev DB');
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
  return JSON.parse(secret) as { clientId: string; apiKey: string };
}

async function queryProductSample(databaseUrl: string): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const rows = await client.query<{ platform_product_id: string }>(
    `SELECT DISTINCT listing.platform_product_id
     FROM platform_listings listing
     JOIN platform_listing_skus pls ON pls.listing_id = listing.id
     WHERE pls.status = 'ACTIVE'
     ORDER BY listing.platform_product_id
     LIMIT 10`,
  );
  await client.end();
  return rows.rows.map((row) => row.platform_product_id);
}

async function call<T>(
  auth: { clientId: string; apiKey: string },
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': auth.clientId,
      'Api-Key': auth.apiKey,
    },
    body: JSON.stringify(body),
  });
  const requestId = response.headers.get('x-o3-trace-id') ?? response.headers.get('x-request-id');
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${endpoint} -> HTTP ${response.status} (req ${requestId}): ${text.slice(0, 400)}`,
    );
  }
  const parsed = JSON.parse(text) as { result?: T } & Record<string, unknown>;
  if (requestId !== null) {
    console.log(`[http] ${endpoint} req=${requestId}`);
  }
  return (parsed.result ?? (parsed as unknown)) as T;
}

function reportTree(label: string, roots: TreeNode[]): void {
  let categories = 0;
  let types = 0;
  let disabledCategories = 0;
  const depthBuckets = new Map<number, number>();
  const walk = (nodes: TreeNode[], depth: number): void => {
    for (const node of nodes) {
      categories += 1;
      if (node.disabled === true) {
        disabledCategories += 1;
      }
      if (node.type_id !== undefined && node.type_id !== null) {
        types += 1;
      }
      depthBuckets.set(depth, (depthBuckets.get(depth) ?? 0) + 1);
      if (Array.isArray(node.children)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(roots, 1);
  console.log(
    `[tree ${label}] roots=${roots.length} categories=${categories} types=${types} disabled=${disabledCategories} depthDistribution=${JSON.stringify([...depthBuckets])}`,
  );
  const first = roots.find((node) => Array.isArray(node.children) && node.children.length > 0);
  if (first !== undefined) {
    const child = first.children?.find((c) => c.children !== undefined) ?? first.children?.[0];
    console.log(
      `[tree ${label}] sample: ${first.category_name} > ${child?.category_name ?? ''} (type ${child?.type_id ?? '-'}: ${child?.type_name ?? '-'})`,
    );
  }
}

function collectTypeKeys(roots: TreeNode[]): Set<string> {
  const keys = new Set<string>();
  const walk = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      if (node.type_id !== undefined && node.type_id !== null) {
        keys.add(`${node.description_category_id}:${node.type_id}`);
      }
      if (Array.isArray(node.children)) {
        walk(node.children);
      }
    }
  };
  walk(roots);
  return keys;
}

main()
  .then(() => {
    console.log('T0 smoke finished');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('T0 smoke failed:', error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
