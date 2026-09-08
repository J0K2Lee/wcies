import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 2 Inventory Core acceptance (task §59-§73, §85-§89) against real
 * PostgreSQL: concurrency, idempotency, the reserve->pick->ship lifecycle,
 * move bin, adjustment safety, NO_RECORD vs ZERO and the read model.
 *
 * Every scenario uses its own SKU so balances never leak between tests.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3110';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
const REF = () => randomUUID();

interface BalanceRow {
  id: string;
  skuId: string;
  skuCode: string;
  warehouseId: string;
  binId: string;
  binCode: string;
  onHandQty: string;
  reservedQty: string;
  pickedQty: string;
  physicalAvailableQty: string;
  safetyQty: string;
  sellableAvailableQty: string;
  status: string;
}
interface ReservationDto {
  id: string;
  reservationNo: string;
  status: string;
  requestedQty: string;
  idempotentReplay: boolean;
  lines: Array<{ binId: string; binCode: string; quantity: string; status: string }>;
}
interface TransactionDto {
  id: string;
  transactionNo: string;
  eventNo: string;
  transactionType: string;
  binCode: string;
  quantityBefore: string;
  quantityChange: string;
  quantityAfter: string;
}
interface StockChangeResultDto {
  eventNo: string;
  transactionNos: string[];
  balance: { onHandQty: string; reservedQty: string; pickedQty: string };
  idempotentReplay: boolean;
}

let warehouseId = '';
let binA01 = '';
let binA02 = '';
let binA03 = '';
let vk87BlkSkuId = '';
let sz01WarehouseId = '';
let sz01A01BinId = '';

/** Fresh isolated SKU per scenario. */
async function newSku(label: string): Promise<string> {
  const product = await client.post<{ id: string }>('/api/v1/products', {
    nameZh: `${PREFIX} ${label}商品`,
  });
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    productId: product.body.data.id,
    nameZh: `${PREFIX} ${label}SKU`,
  });
  return sku.body.data.id;
}

async function initialize(input: {
  skuId: string;
  warehouseId: string;
  binId: string;
  quantity: string;
  idempotencyKey: string;
  remark?: string;
}) {
  return client.post<StockChangeResultDto>('/api/v1/inventory/initialize', {
    skuId: input.skuId,
    warehouseId: input.warehouseId,
    binId: input.binId,
    quantity: input.quantity,
    referenceType: 'MANUAL',
    referenceId: REF(),
    remark: input.remark ?? 'integration',
    idempotencyKey: input.idempotencyKey,
  });
}

/** The single balance row of an isolated scenario SKU (or undefined). */
async function balanceOf(skuId_: string): Promise<BalanceRow | undefined> {
  const list = await client.get<BalanceRow[]>(
    `/api/v1/inventory?skuId=${skuId_}&warehouseId=${warehouseId}&pageSize=100`,
  );
  return list.body.data[0];
}

/** Balance rows of one SKU (multi-bin scenarios), ordered by binCode. */
async function balancesOf(skuId_: string): Promise<BalanceRow[]> {
  const list = await client.get<BalanceRow[]>(
    `/api/v1/inventory?skuId=${skuId_}&warehouseId=${warehouseId}&pageSize=100`,
  );
  return list.body.data;
}

async function reserve(input: {
  skuId: string;
  warehouseId: string;
  quantity: string;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
}) {
  return client.post<ReservationDto>('/api/v1/inventory/reservations', {
    skuId: input.skuId,
    warehouseId: input.warehouseId,
    quantity: input.quantity,
    referenceType: input.referenceType ?? 'TEST',
    referenceId: input.referenceId ?? REF(),
    idempotencyKey: input.idempotencyKey,
  });
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3110', REDIS_URL: 'redis://localhost:6379/9' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-WH`,
    name: `${PREFIX} 库存测试仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { rackFrom: 'A01', rackTo: 'A03', levelFrom: '01', levelTo: '01' },
  );
  binA01 = bins.body.data.bins.find((bin) => bin.binCode.endsWith('A01-01'))!.id;
  binA02 = bins.body.data.bins.find((bin) => bin.binCode.endsWith('A02-01'))!.id;
  binA03 = bins.body.data.bins.find((bin) => bin.binCode.endsWith('A03-01'))!.id;

  // Sprint 1 seed data for the task §85 acceptance scenario.
  const skus = await client.get<Array<{ id: string; skuCode: string }>>(
    `/api/v1/skus?keyword=VK87-BLK`,
  );
  vk87BlkSkuId = skus.body.data.find((item) => item.skuCode === 'VK87-BLK')?.id ?? '';
  const warehouses = await client.get<Array<{ id: string; warehouseCode: string }>>(
    `/api/v1/warehouses?keyword=SZ01`,
  );
  sz01WarehouseId = warehouses.body.data.find((item) => item.warehouseCode === 'SZ01')?.id ?? '';
  if (vk87BlkSkuId !== '' && sz01WarehouseId !== '') {
    const szBins = await client.get<Array<{ id: string; binCode: string }>>(
      `/api/v1/warehouses/${sz01WarehouseId}/bins?keyword=A01-01&pageSize=10`,
    );
    sz01A01BinId = szBins.body.data.find((bin) => bin.binCode === 'SZ01-A01-01')?.id ?? '';
  }
});

afterAll(async () => {
  await api.stop();
});

describe('NO_RECORD vs ZERO (task §70/§89)', () => {
  it('a never-initialized SKU has no balance rows; quantity 0 init creates an explicit zero row', async () => {
    const freshSkuId = await newSku('零记录');
    const before = await client.get<{ bins: Array<{ id: string }>; totals: { onHandQty: string } }>(
      `/api/v1/inventory/skus/${freshSkuId}`,
    );
    expect(before.body.data.bins).toHaveLength(0);
    expect(before.body.data.totals.onHandQty).toBe('0.000');

    const zero = await initialize({
      skuId: freshSkuId,
      warehouseId,
      binId: binA03,
      quantity: '0',
      idempotencyKey: `zero-init:${PREFIX}`,
    });
    expect(zero.body.data.balance.onHandQty).toBe('0.000');

    const after = await client.get<{ bins: Array<{ onHandQty: string; binCode: string }> }>(
      `/api/v1/inventory/skus/${freshSkuId}`,
    );
    expect(after.body.data.bins).toHaveLength(1);
    expect(after.body.data.bins[0]?.onHandQty).toBe('0.000');
  });
});

describe('initialize + idempotency (task §20-§22, §88)', () => {
  it('initializes 10 units and replays duplicates without adding twice', async () => {
    const initSkuId = await newSku('初始化');
    const key = `init:${PREFIX}:a01`;
    const first = await initialize({
      skuId: initSkuId,
      warehouseId,
      binId: binA01,
      quantity: '10',
      idempotencyKey: key,
    });
    expect(first.body.data.balance.onHandQty).toBe('10.000');
    expect(first.body.data.eventNo).toMatch(/^IEV\d{8}$/);

    const second = await initialize({
      skuId: initSkuId,
      warehouseId,
      binId: binA01,
      quantity: '10',
      idempotencyKey: key,
    });
    expect(second.body.data.idempotentReplay).toBe(true);
    expect(second.body.data.eventNo).toBe(first.body.data.eventNo);

    expect((await balanceOf(initSkuId))?.onHandQty).toBe('10.000');

    const ledger = await client.get<TransactionDto[]>(
      `/api/v1/inventory/transactions?skuId=${initSkuId}&transactionType=INITIAL_STOCK&pageSize=100`,
    );
    expect(ledger.body.data).toHaveLength(1);
    expect(ledger.body.data[0]?.quantityChange).toBe('10.000');
  });

  it('rejects a mismatched payload reusing an idempotency key', async () => {
    const conflictSkuId = await newSku('幂等冲突');
    await initialize({
      skuId: conflictSkuId,
      warehouseId,
      binId: binA01,
      quantity: '5',
      idempotencyKey: `conflict:${PREFIX}`,
    });
    const conflict = await initialize({
      skuId: conflictSkuId,
      warehouseId,
      binId: binA02,
      quantity: '5',
      idempotencyKey: `conflict:${PREFIX}`,
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe('INVENTORY_IDEMPOTENCY_CONFLICT');
  });
});

describe('reserve / release / pick / unpick / ship (task §62-§65)', () => {
  it('runs the full lifecycle with correct quantities and ledger', async () => {
    const lifeSkuId = await newSku('生命周期');
    await initialize({
      skuId: lifeSkuId,
      warehouseId,
      binId: binA01,
      quantity: '10',
      idempotencyKey: `life:${PREFIX}:init`,
    });

    const reserved = await reserve({
      skuId: lifeSkuId,
      warehouseId,
      quantity: '3',
      idempotencyKey: `life:${PREFIX}:reserve`,
    });
    const reservationId = reserved.body.data.id;
    expect(reserved.body.data.status).toBe('ACTIVE');
    expect(reserved.body.data.lines).toHaveLength(1);
    expect(reserved.body.data.lines[0]?.quantity).toBe('3.000');

    let row = await balanceOf(lifeSkuId);
    expect(row?.reservedQty).toBe('3.000');
    expect(row?.onHandQty).toBe('10.000');
    expect(row?.physicalAvailableQty).toBe('7.000');

    const picked = await client.post<ReservationDto>(
      `/api/v1/inventory/reservations/${reservationId}/pick`,
      { idempotencyKey: `life:${PREFIX}:pick` },
    );
    expect(picked.body.data.status).toBe('PICKED');
    row = await balanceOf(lifeSkuId);
    expect(row?.reservedQty).toBe('0.000');
    expect(row?.pickedQty).toBe('3.000');
    expect(row?.onHandQty).toBe('10.000');

    await client.post(`/api/v1/inventory/reservations/${reservationId}/unpick`, {
      idempotencyKey: `life:${PREFIX}:unpick`,
    });
    row = await balanceOf(lifeSkuId);
    expect(row?.reservedQty).toBe('3.000');
    expect(row?.pickedQty).toBe('0.000');

    await client.post(`/api/v1/inventory/reservations/${reservationId}/pick`, {
      idempotencyKey: `life:${PREFIX}:pick2`,
    });
    const shipped = await client.post<ReservationDto>(
      `/api/v1/inventory/reservations/${reservationId}/ship`,
      { idempotencyKey: `life:${PREFIX}:ship` },
    );
    expect(shipped.body.data.status).toBe('CONSUMED');
    row = await balanceOf(lifeSkuId);
    expect(row?.onHandQty).toBe('7.000');
    expect(row?.reservedQty).toBe('0.000');
    expect(row?.pickedQty).toBe('0.000');

    // repeat ship with the SAME key replays instead of shipping twice (§30)
    const replayed = await client.post<ReservationDto>(
      `/api/v1/inventory/reservations/${reservationId}/ship`,
      { idempotencyKey: `life:${PREFIX}:ship` },
    );
    expect(replayed.body.data.idempotentReplay).toBe(true);
    expect((await balanceOf(lifeSkuId))?.onHandQty).toBe('7.000');

    // illegal transitions are rejected (task §35)
    const reRelease = await client.post(
      `/api/v1/inventory/reservations/${reservationId}/release`,
      {},
    );
    expect(reRelease.status).toBe(409);
    expect(reRelease.body.error?.code).toBe('INVENTORY_RESERVATION_STATE_INVALID');
    const reShip = await client.post(`/api/v1/inventory/reservations/${reservationId}/ship`, {});
    expect(reShip.status).toBe(409);

    // full audit trail exists for the lifecycle
    const ledger = await client.get<TransactionDto[]>(
      `/api/v1/inventory/transactions?skuId=${lifeSkuId}&pageSize=100`,
    );
    const types = ledger.body.data.map((line) => line.transactionType).sort();
    expect(types).toEqual(['INITIAL_STOCK', 'PICK', 'PICK', 'RESERVE', 'SHIP', 'UNPICK']);
  });

  it('release returns Reserved to available without touching On Hand (task §62)', async () => {
    const relSkuId = await newSku('释放');
    await initialize({
      skuId: relSkuId,
      warehouseId,
      binId: binA01,
      quantity: '10',
      idempotencyKey: `rel:${PREFIX}:init`,
    });
    const created = await reserve({
      skuId: relSkuId,
      warehouseId,
      quantity: '3',
      idempotencyKey: `rel:${PREFIX}:reserve`,
    });
    const released = await client.post<ReservationDto>(
      `/api/v1/inventory/reservations/${created.body.data.id}/release`,
      { idempotencyKey: `rel:${PREFIX}:release` },
    );
    expect(released.body.data.status).toBe('RELEASED');

    const row = await balanceOf(relSkuId);
    expect(row?.onHandQty).toBe('10.000');
    expect(row?.reservedQty).toBe('0.000');
    expect(row?.pickedQty).toBe('0.000');
    expect(row?.physicalAvailableQty).toBe('10.000');
  });
});

describe('concurrency (task §59-§60, §87)', () => {
  it('last item: exactly one of two parallel reserves wins', async () => {
    const lastSkuId = await newSku('最后一件');
    await initialize({
      skuId: lastSkuId,
      warehouseId,
      binId: binA01,
      quantity: '1',
      idempotencyKey: `last:${PREFIX}:init`,
    });
    const results = await Promise.allSettled([
      reserve({ skuId: lastSkuId, warehouseId, quantity: '1', idempotencyKey: `last-a:${PREFIX}` }),
      reserve({ skuId: lastSkuId, warehouseId, quantity: '1', idempotencyKey: `last-b:${PREFIX}` }),
    ]);
    const okCount = results.filter(
      (result) => result.status === 'fulfilled' && result.value.status === 200,
    ).length;
    expect(okCount).toBe(1);
    const loser = results.find(
      (result) => result.status === 'fulfilled' && result.value.status !== 200,
    );
    if (loser?.status === 'fulfilled') {
      expect(loser.value.body.error?.code).toBe('INVENTORY_INSUFFICIENT_STOCK');
    } else {
      throw new Error('expected exactly one loser');
    }
    const row = await balanceOf(lastSkuId);
    expect(row?.reservedQty).toBe('1.000');
  });

  it('100 parallel reserve(1) on 50 units: exactly 50 succeed (task §60)', async () => {
    const c100SkuId = await newSku('百并发');
    await initialize({
      skuId: c100SkuId,
      warehouseId,
      binId: binA01,
      quantity: '50',
      idempotencyKey: `c100:${PREFIX}:init`,
    });
    const attempts = Array.from({ length: 100 }, (_, index) =>
      reserve({
        skuId: c100SkuId,
        warehouseId,
        quantity: '1',
        idempotencyKey: `c100:${PREFIX}:${index}`,
      }).catch(() => undefined),
    );
    const responses = (await Promise.all(attempts)).filter(
      (response): response is Awaited<ReturnType<typeof reserve>> => response !== undefined,
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(50);
    expect(
      responses.filter((response) => response.body.error?.code === 'INVENTORY_INSUFFICIENT_STOCK'),
    ).toHaveLength(50);

    const row = await balanceOf(c100SkuId);
    expect(row?.onHandQty).toBe('50.000');
    expect(row?.reservedQty).toBe('50.000');
  });

  it('duplicate idempotency key x10 parallel: stock moves once (task §61/§88)', async () => {
    const idemSkuId = await newSku('幂等并发');
    await initialize({
      skuId: idemSkuId,
      warehouseId,
      binId: binA01,
      quantity: '10',
      idempotencyKey: `idem10:${PREFIX}:init`,
    });
    const key = `idem10:${PREFIX}:reserve`;
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        reserve({ skuId: idemSkuId, warehouseId, quantity: '3', idempotencyKey: key }).catch(
          () => undefined,
        ),
      ),
    );
    const oks = attempts.filter(
      (response): response is Awaited<ReturnType<typeof reserve>> =>
        response !== undefined && response.status === 200,
    );
    expect(oks.length).toBeGreaterThanOrEqual(1);
    expect(new Set(oks.map((response) => response.body.data.reservationNo)).size).toBe(1);

    const row = await balanceOf(idemSkuId);
    expect(row?.reservedQty).toBe('3.000');

    const ledger = await client.get<TransactionDto[]>(
      `/api/v1/inventory/transactions?skuId=${idemSkuId}&transactionType=RESERVE&pageSize=100`,
    );
    expect(ledger.body.data).toHaveLength(1);
  });
});

describe('multi-bin reservation (task §25/§72, §86)', () => {
  it('spans bins when one bin cannot cover the request', async () => {
    const multiSkuId = await newSku('多Bin');
    await initialize({
      skuId: multiSkuId,
      warehouseId,
      binId: binA01,
      quantity: '2',
      idempotencyKey: `multi:${PREFIX}:a01`,
    });
    await initialize({
      skuId: multiSkuId,
      warehouseId,
      binId: binA02,
      quantity: '4',
      idempotencyKey: `multi:${PREFIX}:a02`,
    });

    const created = await reserve({
      skuId: multiSkuId,
      warehouseId,
      quantity: '5',
      idempotencyKey: `multi:${PREFIX}:reserve`,
    });
    expect(created.status).toBe(200);
    expect(created.body.data.lines).toHaveLength(2);
    const byBin = new Map(
      created.body.data.lines.map((line) => [line.binCode.slice(-6), line.quantity]),
    );
    expect(byBin.get('A01-01')).toBe('2.000');
    expect(byBin.get('A02-01')).toBe('3.000');

    const rows = await balancesOf(multiSkuId);
    const a01 = rows.find((row) => row.binCode.endsWith('A01-01'));
    const a02 = rows.find((row) => row.binCode.endsWith('A02-01'));
    expect(a01?.reservedQty).toBe('2.000');
    expect(a02?.reservedQty).toBe('3.000');

    const ledger = await client.get<TransactionDto[]>(
      `/api/v1/inventory/transactions?skuId=${multiSkuId}&transactionType=RESERVE&pageSize=10`,
    );
    expect(ledger.body.data).toHaveLength(2);
    expect(new Set(ledger.body.data.map((line) => line.eventNo)).size).toBe(1);
  });

  it('parallel opposite moveBins and multi-bin reserves never deadlock (task §73)', async () => {
    const dlSkuId = await newSku('死锁');
    await initialize({
      skuId: dlSkuId,
      warehouseId,
      binId: binA01,
      quantity: '10',
      idempotencyKey: `dl:${PREFIX}:a01`,
    });
    await initialize({
      skuId: dlSkuId,
      warehouseId,
      binId: binA02,
      quantity: '10',
      idempotencyKey: `dl:${PREFIX}:a02`,
    });

    const operations = await Promise.allSettled([
      client.post('/api/v1/inventory/move-bin', {
        skuId: dlSkuId,
        warehouseId,
        fromBinId: binA01,
        toBinId: binA02,
        quantity: '2',
        referenceType: 'MANUAL',
        referenceId: REF(),
        idempotencyKey: `dl-move-a:${PREFIX}`,
      }),
      client.post('/api/v1/inventory/move-bin', {
        skuId: dlSkuId,
        warehouseId,
        fromBinId: binA02,
        toBinId: binA01,
        quantity: '2',
        referenceType: 'MANUAL',
        referenceId: REF(),
        idempotencyKey: `dl-move-b:${PREFIX}`,
      }),
      reserve({ skuId: dlSkuId, warehouseId, quantity: '12', idempotencyKey: `dl-r1:${PREFIX}` }),
      reserve({ skuId: dlSkuId, warehouseId, quantity: '12', idempotencyKey: `dl-r2:${PREFIX}` }),
    ]);
    for (const result of operations) {
      expect(result.status).toBe('fulfilled');
      if (result.status === 'fulfilled') {
        expect(result.value.status).toBeLessThan(500);
      }
    }
    // both moves succeeded -> total stays 20, moved stock nets out per bin
    const detail = await client.get<{ totals: { onHandQty: string } }>(
      `/api/v1/inventory/skus/${dlSkuId}`,
    );
    expect(detail.body.data.totals.onHandQty).toBe('20.000');
  }, 60_000);
});

describe('move bin (task §36-§37, §66-§67)', () => {
  it('moves 4 from A01 to A02 under one two-line event; warehouse total unchanged', async () => {
    const moveSkuId = await newSku('移位');
    await initialize({
      skuId: moveSkuId,
      warehouseId,
      binId: binA01,
      quantity: '10',
      idempotencyKey: `mv:${PREFIX}:init`,
    });

    const move = await client.post<{
      fromBalance: { onHandQty: string };
      toBalance: { onHandQty: string };
      transactionNos: string[];
    }>('/api/v1/inventory/move-bin', {
      skuId: moveSkuId,
      warehouseId,
      fromBinId: binA01,
      toBinId: binA02,
      quantity: '4',
      referenceType: 'MANUAL',
      referenceId: REF(),
      idempotencyKey: `mv:${PREFIX}:move`,
    });
    expect(move.body.data.fromBalance.onHandQty).toBe('6.000');
    expect(move.body.data.toBalance.onHandQty).toBe('4.000');
    expect(move.body.data.transactionNos).toHaveLength(2);

    const ledger = await client.get<TransactionDto[]>(
      `/api/v1/inventory/transactions?skuId=${moveSkuId}&transactionType=MOVE_BIN&pageSize=10`,
    );
    expect(ledger.body.data).toHaveLength(2);
    expect(new Set(ledger.body.data.map((line) => line.eventNo)).size).toBe(1);
    expect(ledger.body.data.map((line) => line.quantityChange).sort()).toEqual(['-4.000', '4.000']);

    const detail = await client.get<{ totals: { onHandQty: string } }>(
      `/api/v1/inventory/skus/${moveSkuId}`,
    );
    expect(detail.body.data.totals.onHandQty).toBe('10.000');

    // replay with the same key changes nothing
    const replay = await client.post('/api/v1/inventory/move-bin', {
      skuId: moveSkuId,
      warehouseId,
      fromBinId: binA01,
      toBinId: binA02,
      quantity: '4',
      referenceType: 'MANUAL',
      referenceId: REF(),
      idempotencyKey: `mv:${PREFIX}:move`,
    });
    expect(replay.body.data?.idempotentReplay).toBe(true);
    expect((await balancesOf(moveSkuId)).map((row) => row.onHandQty)).toEqual(['6.000', '4.000']);
  });

  it('refuses to move occupied stock (task §67)', async () => {
    const occSkuId = await newSku('占用');
    await initialize({
      skuId: occSkuId,
      warehouseId,
      binId: binA01,
      quantity: '10',
      idempotencyKey: `occ:${PREFIX}:init`,
    });
    await reserve({
      skuId: occSkuId,
      warehouseId,
      quantity: '8',
      idempotencyKey: `occ:${PREFIX}:reserve`,
    });

    const move = await client.post('/api/v1/inventory/move-bin', {
      skuId: occSkuId,
      warehouseId,
      fromBinId: binA01,
      toBinId: binA02,
      quantity: '5',
      referenceType: 'MANUAL',
      referenceId: REF(),
      idempotencyKey: `occ:${PREFIX}:move`,
    });
    expect(move.status).toBe(409);
    expect(move.body.error?.code).toBe('INVENTORY_INSUFFICIENT_MOVABLE_STOCK');

    // movable 2 still works
    const small = await client.post('/api/v1/inventory/move-bin', {
      skuId: occSkuId,
      warehouseId,
      fromBinId: binA01,
      toBinId: binA02,
      quantity: '2',
      referenceType: 'MANUAL',
      referenceId: REF(),
      idempotencyKey: `occ:${PREFIX}:move2`,
    });
    expect(small.status).toBe(200);
  });

  it('rejects same-bin moves', async () => {
    const sameSkuId = await newSku('同Bin');
    await initialize({
      skuId: sameSkuId,
      warehouseId,
      binId: binA01,
      quantity: '5',
      idempotencyKey: `same:${PREFIX}:init`,
    });
    const same = await client.post('/api/v1/inventory/move-bin', {
      skuId: sameSkuId,
      warehouseId,
      fromBinId: binA01,
      toBinId: binA01,
      quantity: '1',
      referenceType: 'MANUAL',
      referenceId: REF(),
      idempotencyKey: `same:${PREFIX}:move`,
    });
    expect(same.status).toBe(422);
    expect(same.body.error?.code).toBe('INVENTORY_MOVE_BIN_INVALID');
  });
});

describe('manual adjustment (task §38-§39, §68)', () => {
  it('adjusts +N/-N with reason; negative results rejected atomically without ledger lines', async () => {
    const adjSkuId = await newSku('调整');
    await initialize({
      skuId: adjSkuId,
      warehouseId,
      binId: binA01,
      quantity: '2',
      idempotencyKey: `adj:${PREFIX}:init`,
    });

    const plus = await client.post<StockChangeResultDto>('/api/v1/inventory/adjust', {
      skuId: adjSkuId,
      warehouseId,
      binId: binA01,
      quantityDelta: '2',
      reason: '盘点补录',
      remark: 'integration',
      idempotencyKey: `adj:${PREFIX}:plus`,
    });
    expect(plus.body.data.balance.onHandQty).toBe('4.000');

    const minus = await client.post('/api/v1/inventory/adjust', {
      skuId: adjSkuId,
      warehouseId,
      binId: binA01,
      quantityDelta: '-3',
      reason: '商品损坏',
      idempotencyKey: `adj:${PREFIX}:minus`,
    });
    expect(minus.status).toBe(200);
    expect((await balanceOf(adjSkuId))?.onHandQty).toBe('1.000');

    // would go negative -> rejected, no ledger line (task §68)
    const countBefore = (
      await client.get<TransactionDto[]>(
        `/api/v1/inventory/transactions?skuId=${adjSkuId}&pageSize=100`,
      )
    ).body.data.length;
    const negative = await client.post('/api/v1/inventory/adjust', {
      skuId: adjSkuId,
      warehouseId,
      binId: binA01,
      quantityDelta: '-3',
      reason: '过量扣减',
      idempotencyKey: `adj:${PREFIX}:negative`,
    });
    expect(negative.status).toBe(409);
    expect(negative.body.error?.code).toBe('INVENTORY_ADJUSTMENT_INVALID');
    expect((await balanceOf(adjSkuId))?.onHandQty).toBe('1.000');
    const countAfter = (
      await client.get<TransactionDto[]>(
        `/api/v1/inventory/transactions?skuId=${adjSkuId}&pageSize=100`,
      )
    ).body.data.length;
    expect(countAfter).toBe(countBefore);
  });

  it('rejects adjustment below Reserved/Picked occupancy and on missing balances', async () => {
    const guardSkuId = await newSku('调整护栏');
    await initialize({
      skuId: guardSkuId,
      warehouseId,
      binId: binA01,
      quantity: '5',
      idempotencyKey: `guard:${PREFIX}:init`,
    });
    await reserve({
      skuId: guardSkuId,
      warehouseId,
      quantity: '4',
      idempotencyKey: `guard:${PREFIX}:reserve`,
    });
    const below = await client.post('/api/v1/inventory/adjust', {
      skuId: guardSkuId,
      warehouseId,
      binId: binA01,
      quantityDelta: '-3',
      reason: '低于占用',
      idempotencyKey: `guard:${PREFIX}:below`,
    });
    expect(below.status).toBe(409);

    const missingSkuId = await newSku('未初始化');
    const missing = await client.post('/api/v1/inventory/adjust', {
      skuId: missingSkuId,
      warehouseId,
      binId: binA01,
      quantityDelta: '1',
      reason: '未初始化',
      idempotencyKey: `guard:${PREFIX}:missing`,
    });
    expect(missing.status).toBe(409);
    expect(missing.body.error?.code).toBe('INVENTORY_ADJUSTMENT_INVALID');
  });
});

describe('rollback on concurrent duplicate events (task §69)', () => {
  it('parallel same-key initialize commits once; losers roll back their balance change', async () => {
    const rbSkuId = await newSku('回滚');
    const key = `rb:${PREFIX}:race`;

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        initialize({
          skuId: rbSkuId,
          warehouseId,
          binId: binA01,
          quantity: '5',
          idempotencyKey: key,
        }).catch(() => undefined),
      ),
    );
    const oks = attempts.filter(
      (response): response is Awaited<ReturnType<typeof initialize>> =>
        response !== undefined && response.status === 200,
    );
    expect(oks.length).toBe(8); // losers replay successfully
    expect(oks.filter((response) => response.body.data.idempotentReplay)).toHaveLength(7);

    expect((await balanceOf(rbSkuId))?.onHandQty).toBe('5.000'); // NOT 40

    const ledger = await client.get<TransactionDto[]>(
      `/api/v1/inventory/transactions?skuId=${rbSkuId}&pageSize=100`,
    );
    expect(ledger.body.data).toHaveLength(1);
  });
});

describe('safety stock (task §11-§12, §71)', () => {
  it('physical vs sellable availability follow the documented formulas', async () => {
    const safetySkuId = await newSku('安全库存');
    await initialize({
      skuId: safetySkuId,
      warehouseId,
      binId: binA01,
      quantity: '10',
      idempotencyKey: `safety:${PREFIX}:init`,
    });
    await reserve({
      skuId: safetySkuId,
      warehouseId,
      quantity: '2',
      idempotencyKey: `safety:${PREFIX}:reserve`,
    });
    const second = await reserve({
      skuId: safetySkuId,
      warehouseId,
      quantity: '1',
      idempotencyKey: `safety:${PREFIX}:reserve2`,
    });
    await client.post(`/api/v1/inventory/reservations/${second.body.data.id}/pick`, {
      idempotencyKey: `safety:${PREFIX}:pick`,
    });

    const put = await client.put(`/api/v1/inventory/safety-stocks/${safetySkuId}/${warehouseId}`, {
      safetyQty: '3',
    });
    expect(put.status).toBe(200);

    const row = await balanceOf(safetySkuId);
    // Physical = 10 - 2 - 1 = 7; Sellable = max(7 - 3, 0) = 4 (task §71)
    expect(row?.physicalAvailableQty).toBe('7.000');
    expect(row?.sellableAvailableQty).toBe('4.000');
    expect(row?.safetyQty).toBe('3.000');
    // safety never changed physical facts (inventory.md §41)
    expect(row?.onHandQty).toBe('10.000');

    const safetyList = await client.get(`/api/v1/inventory/safety-stocks?skuId=${safetySkuId}`);
    expect(safetyList.body.data).toHaveLength(1);
    expect(safetyList.body.data[0]?.safetyQty).toBe('3.000');
  });
});

describe('task §85 acceptance: VK87-BLK in SZ01', () => {
  it('reset to 10 + safety 2 -> reserve 3 -> pick -> ship -> onHand 7 sellable 5', async () => {
    if (vk87BlkSkuId === '' || sz01WarehouseId === '' || sz01A01BinId === '') {
      throw new Error('seed data missing: run pnpm seed:dev && pnpm seed:sprint1 first');
    }
    // Normalize leftovers from earlier runs: release ACTIVE, unstick PICKED.
    const existingReservations = await client.get<Array<{ id: string; status: string }>>(
      `/api/v1/inventory/reservations?skuId=${vk87BlkSkuId}&warehouseId=${sz01WarehouseId}&pageSize=100`,
    );
    for (const reservation of existingReservations.body.data) {
      if (reservation.status === 'ACTIVE') {
        await client.post(`/api/v1/inventory/reservations/${reservation.id}/release`, {});
      } else if (reservation.status === 'PICKED') {
        await client.post(`/api/v1/inventory/reservations/${reservation.id}/unpick`, {});
        await client.post(`/api/v1/inventory/reservations/${reservation.id}/release`, {});
      }
    }

    const current = await client.get<BalanceRow[]>(
      `/api/v1/inventory?skuId=${vk87BlkSkuId}&warehouseId=${sz01WarehouseId}&binId=${sz01A01BinId}`,
    );
    const row = current.body.data[0];
    if (row !== undefined) {
      await client.post('/api/v1/inventory/adjust', {
        skuId: vk87BlkSkuId,
        warehouseId: sz01WarehouseId,
        binId: sz01A01BinId,
        quantityDelta: String(10 - Number(row.onHandQty)),
        reason: '验收场景重置',
        idempotencyKey: `s85-reset:${PREFIX}:${Date.now()}`,
      });
    } else {
      await initialize({
        skuId: vk87BlkSkuId,
        warehouseId: sz01WarehouseId,
        binId: sz01A01BinId,
        quantity: '10',
        idempotencyKey: `s85-init:${PREFIX}`,
      });
    }
    await client.put(`/api/v1/inventory/safety-stocks/${vk87BlkSkuId}/${sz01WarehouseId}`, {
      safetyQty: '2',
    });

    const reservation = await reserve({
      skuId: vk87BlkSkuId,
      warehouseId: sz01WarehouseId,
      quantity: '3',
      idempotencyKey: `s85-reserve:${PREFIX}`,
      referenceType: 'ORDER',
    });
    expect(reservation.status).toBe(200);
    const id = reservation.body.data.id;
    await client.post(`/api/v1/inventory/reservations/${id}/pick`, {
      idempotencyKey: `s85-pick:${PREFIX}`,
    });
    await client.post(`/api/v1/inventory/reservations/${id}/ship`, {
      idempotencyKey: `s85-ship:${PREFIX}`,
    });

    const final = await client.get<BalanceRow[]>(
      `/api/v1/inventory?skuId=${vk87BlkSkuId}&warehouseId=${sz01WarehouseId}&binId=${sz01A01BinId}`,
    );
    const finalRow = final.body.data[0];
    expect(finalRow?.onHandQty).toBe('7.000');
    expect(finalRow?.reservedQty).toBe('0.000');
    expect(finalRow?.pickedQty).toBe('0.000');
    expect(finalRow?.sellableAvailableQty).toBe('5.000');
  });
});

describe('list performance with 5000 balances (task §74)', () => {
  it('first page returns in < 500ms', async () => {
    const databaseUrl =
      process.env.DATABASE_URL ?? 'postgresql://wcies:wcies_dev_password@localhost:5432/wcies_dev';
    const pg = new Client({ connectionString: databaseUrl });
    await pg.connect();
    try {
      const warehouseCode = `${PREFIX}-PERF`;
      await pg.query(
        `INSERT INTO warehouses (warehouse_code, name, warehouse_type, country_code)
         VALUES ($1, 'perf', 'SELF', 'CN') ON CONFLICT DO NOTHING`,
        [warehouseCode],
      );
      const wh = await pg.query<{ id: string }>(
        'SELECT id FROM warehouses WHERE warehouse_code = $1',
        [warehouseCode],
      );
      const perfWhId = wh.rows[0]!.id;
      await pg.query(
        `INSERT INTO warehouse_bins (warehouse_id, bin_code, barcode)
         VALUES ($1, 'P01', 'BIN-P01') ON CONFLICT DO NOTHING`,
        [perfWhId],
      );
      const bin = await pg.query<{ id: string }>(
        `SELECT id FROM warehouse_bins WHERE warehouse_id = $1 AND bin_code = 'P01'`,
        [perfWhId],
      );
      const perfBinId = bin.rows[0]!.id;

      const existing = await pg.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM inventory_balances WHERE warehouse_id = $1',
        [perfWhId],
      );
      if (Number(existing.rows[0]!.count) < 5000) {
        // Read-performance fixture only (bulk SQL, never a business movement).
        await pg.query(
          `INSERT INTO products (product_code, name_zh, status)
           SELECT $1 || '-P' || g, 'perf-product-' || g, 'ACTIVE'
           FROM generate_series(1, 5000) g
           ON CONFLICT DO NOTHING`,
          [PREFIX],
        );
        await pg.query(
          `INSERT INTO skus (product_id, sku_code, name_zh, status)
           SELECT p.id, 'PERF-' || split_part(p.product_code, '-P', 1) || '-' || split_part(p.product_code, '-P', 2), 'perf-sku', 'ACTIVE'
           FROM products p
           WHERE p.product_code LIKE $1 || '-P%'
             AND NOT EXISTS (SELECT 1 FROM skus s WHERE s.product_id = p.id)
           ON CONFLICT DO NOTHING`,
          [PREFIX],
        );
        await pg.query(
          `INSERT INTO inventory_balances
             (sku_id, warehouse_id, bin_id, inventory_condition, on_hand_qty, reserved_qty, picked_qty, version)
           SELECT s.id, $1, $2, 'SELLABLE',
                  (10 + (row_number() OVER ()) % 20)::numeric(18,3), 0, 0, 0
           FROM skus s
           WHERE s.sku_code LIKE 'PERF-%' AND s.product_id IN (
             SELECT id FROM products WHERE product_code LIKE $3 || '-P%'
           )
             AND NOT EXISTS (SELECT 1 FROM inventory_balances b WHERE b.sku_id = s.id)`,
          [perfWhId, perfBinId, PREFIX],
        );
      }

      // warm-up + measured run
      await client.get(`/api/v1/inventory?warehouseId=${perfWhId}&page=1&pageSize=50`);
      const started = Date.now();
      const page = await client.get<BalanceRow[]>(
        `/api/v1/inventory?warehouseId=${perfWhId}&page=1&pageSize=50`,
      );
      const elapsed = Date.now() - started;
      expect(page.status).toBe(200);
      expect(page.body.data.length).toBe(50);
      expect(elapsed).toBeLessThan(500);
    } finally {
      await pg.end();
    }
  });
});
