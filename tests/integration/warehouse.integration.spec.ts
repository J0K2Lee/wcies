import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
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

  it('batch-creates racks A01~A05 x levels 01~04 = 20 bins with barcodes (task §41)', async () => {
    const batch = await client.post<{
      createdCount: number;
      bins: Array<{ binCode: string; barcode: string }>;
    }>(`/api/v1/warehouses/${szId}/bins/batch`, {
      rackFrom: 'A01',
      rackTo: 'A05',
      levelFrom: '01',
      levelTo: '04',
    });
    expect(batch.body.data.createdCount).toBe(20);
    expect(batch.body.data.bins[0]?.binCode).toBe(`${PREFIX}-SZ-A01-01`);
    expect(batch.body.data.bins[0]?.barcode).toBe(`BIN-${PREFIX}-SZ-A01-01`);
  });

  it('rejects a conflicting batch before inserting anything', async () => {
    const conflict = await client.post(`/api/v1/warehouses/${szId}/bins/batch`, {
      rackFrom: 'A02',
      rackTo: 'A02',
      levelFrom: '01',
      levelTo: '02',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe('WAREHOUSE_BIN_ALREADY_EXISTS');
  });

  it('allows the same bin_code in a DIFFERENT warehouse (task §81)', async () => {
    const second = await client.post<{ id: string }>('/api/v1/warehouses', {
      warehouseCode: `${PREFIX}-WH2`,
      name: 'second',
      warehouseType: 'THIRD_PARTY',
    });
    secondWhId = second.body.data.id;
    const bin = await client.post(`/api/v1/warehouses/${secondWhId}/bins`, {
      binCode: `${PREFIX}-SZ-A01-01`,
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

describe('store warehouse bindings (task §83)', () => {
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

  it('binds one store to TWO warehouses (RFBS -> SZ, FBO -> FBO warehouse, task §83)', async () => {
    const rfbs = await client.post<{ fulfillmentMode: string }>(
      `/api/v1/stores/${ozonStoreId}/warehouse-bindings`,
      { warehouseId: szId, fulfillmentMode: 'OZON_RFBS', platformWarehouseId: '88877' },
    );
    expect(rfbs.body.data.fulfillmentMode).toBe('OZON_RFBS');

    const fbo = await client.post<{ fulfillmentMode: string }>(
      `/api/v1/stores/${ozonStoreId}/warehouse-bindings`,
      { warehouseId: fboId, fulfillmentMode: 'OZON_FBO' },
    );
    expect(fbo.body.data.fulfillmentMode).toBe('OZON_FBO');
  });

  it('rejects WB store + OZON_FBO (platform mismatch, task §45/§83)', async () => {
    const bad = await client.post(`/api/v1/stores/${wbStoreId}/warehouse-bindings`, {
      warehouseId: fboId,
      fulfillmentMode: 'OZON_FBO',
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error?.code).toBe('STORE_WAREHOUSE_BINDING_INVALID');
  });

  it('rejects OZON_FBO against a SELF warehouse (type mismatch)', async () => {
    const bad = await client.post(`/api/v1/stores/${ozonStoreId}/warehouse-bindings`, {
      warehouseId: szId,
      fulfillmentMode: 'OZON_FBO',
    });
    expect(bad.status).toBe(422);
  });

  it('shares ONE warehouse across MULTIPLE stores (task §83)', async () => {
    const shared = await client.post<{ warehouseCode: string }>(
      `/api/v1/stores/${ozonStore2Id}/warehouse-bindings`,
      { warehouseId: szId, fulfillmentMode: 'OZON_FBS' },
    );
    expect(shared.body.data.warehouseCode).toBe(`${PREFIX}-SZ`);

    const wbSelf = await client.post<{ fulfillmentMode: string }>(
      `/api/v1/stores/${wbStoreId}/warehouse-bindings`,
      { warehouseId: szId, fulfillmentMode: 'WB_FBS' },
    );
    expect(wbSelf.body.data.fulfillmentMode).toBe('WB_FBS');
  });

  it('shows bound store count on the warehouse list (task §69)', async () => {
    const list = await client.get<
      Array<{ warehouseCode: string; binCount: number; boundStoreCount: number }>
    >(`/api/v1/warehouses?keyword=${PREFIX}`);
    const sz = list.body.data.find((wh) => wh.warehouseCode === `${PREFIX}-SZ`);
    expect(sz?.binCount).toBe(20);
    expect(sz?.boundStoreCount).toBe(3);
  });
});
