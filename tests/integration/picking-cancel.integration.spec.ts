import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * 拣货中订单取消（2026-11-03 用户确认口径）：
 *
 *   已拣 N 件全部进拦截、剩余不再拣。
 *
 * 该口径要求拣货行可以「部分撤出」——未拣余量释放回可售，已拣数量保持
 * Picked 交给拦截中心，拣货行落 CANCELLED 并记下撤出数量。此前的行为是
 * 「只要有扫码进度就整单拒绝取消」，平台取消后拣货员仍会把剩下的拣完再
 * 拦截，产生大量无效劳动。本套用例在真实 PostgreSQL 上验证：
 *
 * 1. 部分拣货后取消：Reserved 回落到 0、Picked 保持、拦截数量 = 已拣；
 * 2. 合并任务里只撤被取消订单的行，其他订单继续拣；
 * 3. 零进度的整任务取消，以及取消后的扫码被 409 拦住。
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3128';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
const REF = () => randomUUID();

interface IngestResult {
  orderId: string;
  orderNo: string;
  erpStatus: string;
  itemResults: Array<{
    orderItemId: string;
    fulfillmentStatus: string;
    reservationId: string | null;
  }>;
}

interface TaskItem {
  id: string;
  orderId: string;
  orderNo: string;
  skuCode: string;
  requiredQty: string;
  pickedQty: string;
  status: string;
  cancelledQty: string;
  cancelReason: string | null;
}

interface TaskDetail {
  id: string;
  pickingNo: string;
  status: string;
  items: TaskItem[];
}

let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binA01 = '';

async function newSku(label: string): Promise<string> {
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label}SKU`,
  });
  return sku.body.data.id;
}

async function addBarcode(skuId: string, barcode: string): Promise<void> {
  await client.post(`/api/v1/skus/${skuId}/barcodes`, {
    barcode,
    barcodeType: 'EAN',
    isPrimary: true,
  });
}

async function initialize(skuId: string, quantity: string): Promise<void> {
  await client.post('/api/v1/inventory/initialize', {
    skuId,
    warehouseId,
    binId: binA01,
    quantity,
    condition: 'SELLABLE',
    referenceType: 'MANUAL',
    referenceId: REF(),
    idempotencyKey: `IT-PCANCEL-INIT:${randomUUID()}`,
  });
}

async function mapSku(skuId: string, platformSkuId: string): Promise<void> {
  await client.post('/api/v1/listings', {
    platformId: ozonPlatformId,
    storeId,
    platformProductId: `${PREFIX}-PP-${platformSkuId}`,
    skuVariants: [{ skuId, platformSkuId }],
  });
}

async function ingestOrder(
  items: Array<{ platformSkuId: string; quantity: string }>,
): Promise<IngestResult> {
  const result = await client.post<IngestResult>('/api/v1/orders/ingest', {
    storeId,
    platformOrderId: `PO-${randomUUID()}`,
    platformStatus: 'new',
    fulfillmentMode: 'FBS',
    orderedAt: new Date().toISOString(),
    items,
  });
  return result.body.data;
}

async function balancesOf(
  skuId: string,
): Promise<{ onHand: number; reserved: number; picked: number }> {
  const list = await client.get<
    Array<{ onHandQty: string; reservedQty: string; pickedQty: string }>
  >(`/api/v1/inventory?skuId=${skuId}&warehouseId=${warehouseId}&pageSize=100`);
  const sum = (
    pick: (row: { onHandQty: string; reservedQty: string; pickedQty: string }) => string,
  ) => list.body.data.reduce((acc, row) => acc + Number(pick(row)), 0);
  return {
    onHand: sum((row) => row.onHandQty),
    reserved: sum((row) => row.reservedQty),
    picked: sum((row) => row.pickedQty),
  };
}

async function taskDetail(taskId: string): Promise<TaskDetail> {
  const detail = await client.get<TaskDetail>(`/api/v1/picking-tasks/${taskId}`);
  return detail.body.data;
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3128', REDIS_URL: 'redis://localhost:6379/15' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';

  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-C`,
    name: `${PREFIX} 取消店`,
  });
  storeId = store.body.data.id;

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-CWH`,
    name: `${PREFIX} 取消测试仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 1, levelsPerRack: 1 },
  );
  binA01 = bins.body.data.bins.find((b) => b.binCode.endsWith('A01-1'))?.id ?? '';

  await bindPlatformWarehouse(client, storeId, warehouseId, 'OZON_RFBS');
});

afterAll(async () => {
  await api.stop();
});

describe('拣货中订单取消：已拣进拦截、剩余不再拣', () => {
  it('部分拣货后取消：Reserved 回落、Picked 保持、拦截数量=已拣', async () => {
    const skuId = await newSku('PC1');
    const barcode = `${PREFIX}-PC1-BAR`;
    await addBarcode(skuId, barcode);
    await initialize(skuId, '10');
    await mapSku(skuId, `${PREFIX}-PC1`);
    const order = await ingestOrder([{ platformSkuId: `${PREFIX}-PC1`, quantity: '5' }]);

    const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: order.orderId,
    });
    const taskId = created.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    for (let i = 0; i < 2; i += 1) {
      const scan = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
      expect(scan.status).toBe(200);
    }
    expect(await balancesOf(skuId)).toEqual({ onHand: 10, reserved: 3, picked: 2 });

    const cancel = await client.post<{ erpStatus: string; interceptions: number }>(
      `/api/v1/orders/${order.orderId}/cancel`,
      { reason: '平台取消' },
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.erpStatus).toBe('CANCELLED');
    expect(cancel.body.data.interceptions).toBe(1);

    // 库存：未拣的 3 件释放回可售（Reserved 归零），已拣 2 件仍为 Picked，
    // 实物还在拣货车上——只能由拦截流程找回（§42），这里绝不清零。
    expect(await balancesOf(skuId)).toEqual({ onHand: 10, reserved: 0, picked: 2 });

    // 拦截数量来自预约里真实的 picked_qty，而不是订购数量 5。
    const interceptions = await client.get<Array<{ id: string }>>(
      `/api/v1/interceptions?orderId=${order.orderId}`,
    );
    expect(interceptions.body.data).toHaveLength(1);
    const interception = await client.get<{
      status: string;
      item: { remainingQty: string } | null;
    }>(`/api/v1/interceptions/${interceptions.body.data[0]!.id}`);
    expect(interception.body.data.status).toBe('CREATED');
    expect(interception.body.data.item!.remainingQty).toBe('2.000');

    // 拣货行：部分撤出，剩余 3 件不再拣。
    const task = await taskDetail(taskId);
    const row = task.items.find((item) => item.orderId === order.orderId)!;
    expect(row.status).toBe('CANCELLED');
    expect(row.pickedQty).toBe('2.000');
    expect(row.cancelledQty).toBe('3.000');
    expect(row.cancelReason).toContain('平台取消');
    // 有已拣行的任务收口为 COMPLETED（拣的部分确实拣完了），不是 CANCELLED。
    expect(task.status).toBe('COMPLETED');

    // 库存流水：RELEASE_REMAINDER 只释放余量，Reserved -3，Picked 不变。
    const ledger = await client.get<
      Array<{ transactionType: string; reservedChange: string | null; pickedChange: string | null }>
    >(`/api/v1/inventory/transactions?skuId=${skuId}&pageSize=100`);
    const remainder = ledger.body.data.find((row) => row.transactionType === 'RELEASE_REMAINDER');
    expect(remainder).toBeDefined();
    expect(Number(remainder!.reservedChange)).toBe(-3);
    expect(remainder!.pickedChange === null || Number(remainder!.pickedChange) === 0).toBe(true);

    // 订单行：事实是「已拣 2 件」，取消不能把它抹成 RELEASED。
    const cancelledOrder = await client.get<{
      erpStatus: string;
      items: Array<{ fulfillmentStatus: string }>;
    }>(`/api/v1/orders/${order.orderId}`);
    expect(cancelledOrder.body.data.erpStatus).toBe('CANCELLED');
    expect(cancelledOrder.body.data.items[0]!.fulfillmentStatus).toBe('PICKED');

    // 仓库通知（订阅驱动）：PICKING_ORDER_CANCELLED 的 SYSTEM 记录存在。
    const notifications = await client.get<
      Array<{ type: string; channel: string; referenceId: string; title: string }>
    >(`/api/v1/notifications?type=PICKING_ORDER_CANCELLED&referenceId=${order.orderId}`);
    const cancelNotice = notifications.body.data.find(
      (row) => row.type === 'PICKING_ORDER_CANCELLED' && row.channel === 'SYSTEM',
    );
    expect(cancelNotice).toBeDefined();
    expect(cancelNotice!.title).toContain(order.orderNo);

    // 任务已收口（有已拣行 → COMPLETED），继续扫会被任务状态挡住，
    // 撤出后的剩余数量不会再被拣走。
    const rescan = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    expect(rescan.status).toBe(409);
    expect(rescan.body.error?.code).toBe('PICKING_TASK_STATE_INVALID');
    expect((await taskDetail(taskId)).items[0]!.pickedQty).toBe('2.000');
  });

  it('合并任务：只撤被取消订单的行，其他订单继续拣', async () => {
    const skuId = await newSku('PC2');
    const barcode = `${PREFIX}-PC2-BAR`;
    await addBarcode(skuId, barcode);
    await initialize(skuId, '10');
    await mapSku(skuId, `${PREFIX}-PC2`);
    const keep = await ingestOrder([{ platformSkuId: `${PREFIX}-PC2`, quantity: '1' }]);
    const drop = await ingestOrder([{ platformSkuId: `${PREFIX}-PC2`, quantity: '2' }]);

    const created = await client.post<{ created: number; createdTaskNos: string[] }>(
      '/api/v1/picking-tasks/auto-create',
      { orderIds: [keep.orderId, drop.orderId] },
    );
    // 同仓合并：两个订单进同一个任务。
    expect(created.body.data.created).toBe(1);
    const list = await client.get<Array<{ id: string }>>(
      `/api/v1/picking-tasks?orderId=${keep.orderId}&pageSize=100`,
    );
    const taskId = list.body.data[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});

    const before = await taskDetail(taskId);
    expect(before.items).toHaveLength(2);

    const cancel = await client.post<{ interceptions: number }>(
      `/api/v1/orders/${drop.orderId}/cancel`,
      { reason: '买家取消' },
    );
    expect(cancel.body.data.interceptions).toBe(0); // 一件都没拣，无需拦截

    const after = await taskDetail(taskId);
    // 任务仍在进行中：另一单的行还没拣。
    expect(after.status).toBe('IN_PROGRESS');
    const dropped = after.items.find((item) => item.orderId === drop.orderId)!;
    const kept = after.items.find((item) => item.orderId === keep.orderId)!;
    expect(dropped.status).toBe('CANCELLED');
    expect(dropped.cancelledQty).toBe('2.000');
    expect(dropped.cancelReason).toContain('买家取消');
    expect(kept.status).toBe('PENDING');
    expect(kept.cancelledQty).toBe('0.000');

    // 库存：被取消的 2 件回到可售，另一单的 1 件仍占用。
    expect(await balancesOf(skuId)).toEqual({ onHand: 10, reserved: 1, picked: 0 });

    // 剩下那单照常扫完。
    const scan = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    expect(scan.status).toBe(200);
  });

  it('零进度任务取消：整任务 CANCELLED，库存全额释放', async () => {
    const skuId = await newSku('PC3');
    const barcode = `${PREFIX}-PC3-BAR`;
    await addBarcode(skuId, barcode);
    await initialize(skuId, '5');
    await mapSku(skuId, `${PREFIX}-PC3`);
    const order = await ingestOrder([{ platformSkuId: `${PREFIX}-PC3`, quantity: '3' }]);

    const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: order.orderId,
    });
    const taskId = created.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    expect(await balancesOf(skuId)).toEqual({ onHand: 5, reserved: 3, picked: 0 });

    await client.post(`/api/v1/orders/${order.orderId}/cancel`, {});

    const task = await taskDetail(taskId);
    expect(task.status).toBe('CANCELLED');
    expect(task.items[0]!.status).toBe('CANCELLED');
    expect(task.items[0]!.cancelledQty).toBe('3.000');
    expect(await balancesOf(skuId)).toEqual({ onHand: 5, reserved: 0, picked: 0 });

    const rescan = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    expect(rescan.status).toBe(409);
    expect(rescan.body.error?.code).toBe('PICKING_TASK_STATE_INVALID');
    const afterScanAttempt = await taskDetail(taskId);
    expect(afterScanAttempt.items[0]!.pickedQty).toBe('0.000');
  });
});

describe('行级取消（订单不取消，未拣的行可取消）', () => {
  it('取消未拣行：释放占用、订单行回待分配，任务可重新生成', async () => {
    const skuId = await newSku('PC4');
    const barcode = `${PREFIX}-PC4-BAR`;
    await addBarcode(skuId, barcode);
    await initialize(skuId, '5');
    await mapSku(skuId, `${PREFIX}-PC4`);
    const order = await ingestOrder([{ platformSkuId: `${PREFIX}-PC4`, quantity: '2' }]);

    const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: order.orderId,
    });
    const taskId = created.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    const itemId = (await taskDetail(taskId)).items[0]!.id;

    const cancelled = await client.post<{
      status: string;
      items: Array<{ status: string; cancelledQty: string; cancelReason: string | null }>;
    }>(`/api/v1/picking-tasks/${taskId}/items/${itemId}/cancel`, { reason: '这一行不拣了' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.items[0]!.status).toBe('CANCELLED');
    expect(cancelled.body.data.items[0]!.cancelledQty).toBe('2.000');
    expect(cancelled.body.data.items[0]!.cancelReason).toBe('这一行不拣了');

    // 库存回到「未被占用」，实物仍在货架。
    expect(await balancesOf(skuId)).toEqual({ onHand: 5, reserved: 0, picked: 0 });

    // 订单没被取消，行回到待分配。
    const detail = await client.get<{
      erpStatus: string;
      items: Array<{ fulfillmentStatus: string }>;
    }>(`/api/v1/orders/${order.orderId}`);
    expect(detail.body.data.erpStatus).not.toBe('CANCELLED');
    expect(['BACKORDERED', 'PARTIALLY_BACKORDERED', 'PENDING', 'READY_TO_PICK']).toContain(
      detail.body.data.erpStatus,
    );
    expect(detail.body.data.items[0]!.fulfillmentStatus).toBe('PENDING');

    // 行已撤销，没有可拣行 → 不能再建任务（需要重新分配后再建）。
    const again = await client.post(`/api/v1/picking-tasks`, { orderId: order.orderId });
    expect(again.status).toBe(422);
    expect(again.body.error?.code).toBe('PICKING_NO_ELIGIBLE_ITEMS');
  });

  it('已有拣货进度的行拒绝取消：PICKING_ITEM_NOT_CANCELLABLE，库存不动', async () => {
    const skuId = await newSku('PC5');
    const barcode = `${PREFIX}-PC5-BAR`;
    await addBarcode(skuId, barcode);
    await initialize(skuId, '5');
    await mapSku(skuId, `${PREFIX}-PC5`);
    const order = await ingestOrder([{ platformSkuId: `${PREFIX}-PC5`, quantity: '3' }]);

    const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: order.orderId,
    });
    const taskId = created.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    const itemId = (await taskDetail(taskId)).items[0]!.id;

    const before = await balancesOf(skuId);
    const rejected = await client.post(`/api/v1/picking-tasks/${taskId}/items/${itemId}/cancel`, {
      reason: '不拣了',
    });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error?.code).toBe('PICKING_ITEM_NOT_CANCELLABLE');
    expect(await balancesOf(skuId)).toEqual(before);

    // 行仍然可拣/可扫，订单状态不受影响。
    const scan = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    expect(scan.status).toBe(200);
  });
});
