import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Warehouse + bins + store bindings integration (task §81, §83):
 * N:M relations, batch bins, fulfillment-mode validation.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3106';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3106', REDIS_URL: 'redis://localhost:6379/5' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
});

afterAll(async () => {
  await api.stop();
});

describe('warehouses + bins (task §81)', () => {
  let szId = '';
  let secondWhId = '';
  let singleWhId = '';

  it('creates the Shenzhen SELF warehouse and an OZON PLATFORM warehouse', async () => {
    const sz = await client.post<{ id: string }>('/api/v1/warehouses', {
      warehouseCode: `${PREFIX}-SZ`,
      name: `${PREFIX} 深圳自管仓`,
      warehouseType: 'SELF',
      countryCode: 'CN',
      city: '深圳',
    });
    expect(sz.body.success).toBe(true);
    szId = sz.body.data.id;

    const fbo = await client.post<{ id: string }>('/api/v1/warehouses', {
      warehouseCode: `${PREFIX}-FBO`,
      name: `${PREFIX} OZON FBO仓`,
      warehouseType: 'PLATFORM',
      countryCode: 'RU',
    });
    expect(fbo.body.success).toBe(true);
  });

  it('rejects duplicate warehouse_code', async () => {
    const dup = await client.post('/api/v1/warehouses', {
      warehouseCode: `${PREFIX}-SZ`,
      name: 'dup',
      warehouseType: 'SELF',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error?.code).toBe('WAREHOUSE_CODE_ALREADY_EXISTS');
  });

  it('batch-creates a zone with racks and levels, barcode = code (task §41)', async () => {
    const batch = await client.post<{
      createdCount: number;
      bins: Array<{ binCode: string; barcode: string; zone: string; rack: string }>;
    }>(`/api/v1/warehouses/${szId}/bins/batch`, {
      zone: 'A',
      rackStart: 1,
      rackCount: 5,
      levelsPerRack: 4,
    });
    expect(batch.body.data.createdCount).toBe(20);
    expect(batch.body.data.bins[0]?.binCode).toBe(`${PREFIX}-SZ-A01-1`);
    expect(batch.body.data.bins[0]?.zone).toBe('A');
    expect(batch.body.data.bins[0]?.rack).toBe('A01');
    // The printed barcode is the code itself so a scan always resolves.
    expect(batch.body.data.bins[0]?.barcode).toBe(batch.body.data.bins[0]?.binCode);
  });

  it('pads rack numbers past 99 so lexical order stays walk order', async () => {
    // Own warehouse: this batch must not disturb the shared szId bin counts
    // asserted further down.
    const paddedWh = await client.post<{ id: string }>('/api/v1/warehouses', {
      warehouseCode: `${PREFIX}-PAD`,
      name: `${PREFIX} 补零仓`,
      warehouseType: 'SELF',
    });
    const padded = await client.post<{
      bins: Array<{ binCode: string }>;
    }>(`/api/v1/warehouses/${paddedWh.body.data.id}/bins/batch`, {
      zone: 'B',
      rackStart: 99,
      rackCount: 3,
      levelsPerRack: 1,
    });
    expect(padded.body.data.bins.map((bin) => bin.binCode)).toEqual([
      `${PREFIX}-PAD-B099-1`,
      `${PREFIX}-PAD-B100-1`,
      `${PREFIX}-PAD-B101-1`,
    ]);
  });

  it('rejects a conflicting batch before inserting anything', async () => {
    const conflict = await client.post(`/api/v1/warehouses/${szId}/bins/batch`, {
      zone: 'A',
      rackStart: 1,
      rackCount: 1,
      levelsPerRack: 1,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe('WAREHOUSE_BIN_ALREADY_EXISTS');
  });

  it('filters bins by zone', async () => {
    const zoneA = await client.get<Array<{ binCode: string }>>(
      `/api/v1/warehouses/${szId}/bins?zone=A&pageSize=100`,
    );
    expect(zoneA.body.data.length).toBe(20);
    const zones = await client.get<string[]>(`/api/v1/warehouses/${szId}/bins/zones`);
    expect(zones.body.data).toEqual(['A']);
  });

  // The ambiguity this guards: the single-create dialog used to take a free
  // rack string while the batch dialog derived the rack from the zone, so the
  // same "zone A" produced A01 in one path and C01 in the other.
  // Own warehouse: these cases must not disturb the shared szId bin counts.
  it('derives the rack from the zone in the SINGLE create path too', async () => {
    const wh = await client.post<{ id: string }>('/api/v1/warehouses', {
      warehouseCode: `${PREFIX}-SINGLE`,
      name: `${PREFIX} 单建仓`,
      warehouseType: 'SELF',
    });
    singleWhId = wh.body.data.id;

    const single = await client.post<{
      binCode: string;
      rack: string;
      zone: string;
      level: string;
    }>(`/api/v1/warehouses/${singleWhId}/bins`, {
      zone: 'C',
      rackNumber: 1,
      level: '2',
    });
    expect(single.status).toBe(201);
    // Same shape the batch path produces for zone C: rack C01, level plain.
    expect(single.body.data.rack).toBe('C01');
    expect(single.body.data.zone).toBe('C');
    expect(single.body.data.binCode).toBe(`${PREFIX}-SINGLE-C01-2`);
  });

  it('collapses zero-padded levels so 01 and 1 cannot become two codes', async () => {
    const padded = await client.post<{ binCode: string }>(`/api/v1/warehouses/${singleWhId}/bins`, {
      zone: 'C',
      rackNumber: 2,
      level: '02',
    });
    expect(padded.status).toBe(201);
    expect(padded.body.data.binCode).toBe(`${PREFIX}-SINGLE-C02-2`);

    // The same physical level must collide, not create a second bin.
    const duplicate = await client.post(`/api/v1/warehouses/${singleWhId}/bins`, {
      zone: 'C',
      rackNumber: 2,
      level: '2',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error?.code).toBe('WAREHOUSE_BIN_ALREADY_EXISTS');
  });

  it('requires enough input to generate a code', async () => {
    const missing = await client.post(`/api/v1/warehouses/${singleWhId}/bins`, { zone: 'D' });
    expect(missing.status).toBe(422);
    expect(missing.body.error?.code).toBe('WAREHOUSE_BIN_BATCH_INVALID');
  });

  it('allows the same bin_code in a DIFFERENT warehouse (task §81)', async () => {
    const second = await client.post<{ id: string }>('/api/v1/warehouses', {
      warehouseCode: `${PREFIX}-WH2`,
      name: 'second',
      warehouseType: 'THIRD_PARTY',
    });
    secondWhId = second.body.data.id;
    const bin = await client.post(`/api/v1/warehouses/${secondWhId}/bins`, {
      binCode: `${PREFIX}-SZ-A01-1`,
    });
    expect(bin.body.success).toBe(true);
  });

  it('deactivates a warehouse (no hard delete)', async () => {
    const deactivated = await client.post<{ status: string }>(
      `/api/v1/warehouses/${secondWhId}/deactivate`,
    );
    expect(deactivated.body.data.status).toBe('INACTIVE');
  });
});

describe('warehouse platform bindings (仓库绑定平台仓库, 2026-09-17)', () => {
  let ozonStoreId = '';
  let ozonStore2Id = '';
  let wbStoreId = '';
  let szId = '';
  let fboId = '';

  beforeAll(async () => {
    const platforms = await client.get<Array<{ id: string; code: string }>>('/api/v1/platforms');
    const ozon = platforms.body.data.find((platform) => platform.code === 'OZON')?.id ?? '';
    const wb = platforms.body.data.find((platform) => platform.code === 'WB')?.id ?? '';

    const stores = await client.get<Array<{ id: string; storeCode: string }>>(
      `/api/v1/stores?keyword=${PREFIX}`,
    );
    const mine = stores.body.data.filter((store) => store.storeCode.startsWith(PREFIX));

    if (mine.length >= 3) {
      ozonStoreId = mine.find((store) => store.storeCode.endsWith('OZ-A'))?.id ?? '';
      ozonStore2Id = mine.find((store) => store.storeCode.endsWith('OZ-B'))?.id ?? '';
      wbStoreId = mine.find((store) => store.storeCode.endsWith('WB'))?.id ?? '';
    } else {
      // this spec file's stores (created below in practice by earlier specs)
      const a = await client.post<{ id: string }>('/api/v1/stores', {
        platformId: ozon,
        storeCode: `${PREFIX}-OZ-A`,
        name: 'A',
      });
      const b = await client.post<{ id: string }>('/api/v1/stores', {
        platformId: ozon,
        storeCode: `${PREFIX}-OZ-B`,
        name: 'B',
      });
      const w = await client.post<{ id: string }>('/api/v1/stores', {
        platformId: wb,
        storeCode: `${PREFIX}-WB`,
        name: 'WB',
      });
      ozonStoreId = a.body.data.id;
      ozonStore2Id = b.body.data.id;
      wbStoreId = w.body.data.id;
    }

    const warehouses = await client.get<
      Array<{ id: string; warehouseCode: string; warehouseType: string }>
    >(`/api/v1/warehouses?keyword=${PREFIX}`);
    szId = warehouses.body.data.find((wh) => wh.warehouseCode === `${PREFIX}-SZ`)?.id ?? '';
    fboId = warehouses.body.data.find((wh) => wh.warehouseCode === `${PREFIX}-FBO`)?.id ?? '';
  });

  it('binds one warehouse to platform warehouses of multiple stores (用户指示 2026-09-17)', async () => {
    const rfbs = await bindPlatformWarehouse(client, ozonStoreId, szId, 'OZON_RFBS');
    expect(rfbs.id).not.toBe('');

    const fbsSameStore = await bindPlatformWarehouse(client, ozonStore2Id, szId, 'OZON_FBS');
    expect(fbsSameStore.id).not.toBe('');
  });

  it('binds an FBO platform warehouse to the PLATFORM (托管仓) warehouse', async () => {
    const fbo = await client.post<{ fulfillmentMode: string }>(
      `/api/v1/warehouses/${fboId}/platform-bindings`,
      {
        storeId: ozonStoreId,
        platformWarehouseId: `pw-fbo-${randomUUID().slice(0, 8)}`,
        fulfillmentMode: 'OZON_FBO',
      },
    );
    expect(fbo.body.data.fulfillmentMode).toBe('OZON_FBO');
  });

  it('rejects a SECOND platform warehouse on a 托管仓 (single binding, 用户指示 2026-09-17)', async () => {
    const bad = await client.post(`/api/v1/warehouses/${fboId}/platform-bindings`, {
      storeId: ozonStore2Id,
      platformWarehouseId: `pw-fbo-2-${randomUUID().slice(0, 8)}`,
      fulfillmentMode: 'OZON_FBO',
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error?.code).toBe('WAREHOUSE_PLATFORM_BINDING_INVALID');
  });

  it('rejects WB store + OZON_FBO (platform mismatch, task §45/§83)', async () => {
    const bad = await client.post(`/api/v1/warehouses/${szId}/platform-bindings`, {
      storeId: wbStoreId,
      platformWarehouseId: `pw-${randomUUID().slice(0, 8)}`,
      fulfillmentMode: 'OZON_FBO',
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error?.code).toBe('WAREHOUSE_PLATFORM_BINDING_INVALID');
  });

  it('rejects OZON_FBO against a SELF warehouse (type mismatch)', async () => {
    const bad = await client.post(`/api/v1/warehouses/${szId}/platform-bindings`, {
      storeId: ozonStoreId,
      platformWarehouseId: `pw-${randomUUID().slice(0, 8)}`,
      fulfillmentMode: 'OZON_FBO',
    });
    expect(bad.status).toBe(422);
  });

  it('rejects OZON_FBP against a SELF warehouse (半托管 needs SEMI_MANAGED 仓)', async () => {
    const bad = await client.post(`/api/v1/warehouses/${szId}/platform-bindings`, {
      storeId: ozonStoreId,
      platformWarehouseId: `pw-${randomUUID().slice(0, 8)}`,
      fulfillmentMode: 'OZON_FBP',
    });
    expect(bad.status).toBe(422);
  });

  it('shares ONE warehouse across MULTIPLE stores (task §83)', async () => {
    const wbSelf = await bindPlatformWarehouse(client, wbStoreId, szId, 'WB_FBS');
    expect(wbSelf.id).not.toBe('');

    const list = await client.get<
      Array<{ warehouseCode: string; boundPlatformWarehouseCount: number }>
    >(`/api/v1/warehouses?keyword=${PREFIX}`);
    const sz = list.body.data.find((wh) => wh.warehouseCode === `${PREFIX}-SZ`);
    // OZ-A RFBS + OZ-B FBS + WB_FBS = 3 条 ACTIVE 平台仓库绑定
    expect(sz?.boundPlatformWarehouseCount).toBe(3);
  });
});
