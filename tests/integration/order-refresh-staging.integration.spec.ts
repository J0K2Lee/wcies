import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { OrderEntity } from '../../apps/api/src/modules/order/entities/order.entity';
import { OrderItemEntity } from '../../apps/api/src/modules/order/entities/order-item.entity';
import { OrderRepository } from '../../apps/api/src/modules/order/repositories/order.repository';

/**
 * 分阶段回读阈值（2026-10-27，系统设置可改）真实 PG 验证：
 *
 * 背景：OZON `/v3/posting/fbs/list` 只按 `in_process_at`（下单时间）过滤，
 * 取消订单不会再出现在列表窗口里；唯一能发现取消的是定向回读
 * `refreshPlatformFacts`。一刀切 24h 会让「打印面单时才发现已取消」成为常态，
 * 因此按平台阶段分档：AWAITING_SHIPMENT 最勤（取消失败点就在这里），
 * IN_TRANSIT 次之，其余最慢。
 *
 * 本测试直接驱动 OrderRepository（不启 API 进程），验证三段 SQL 在真实
 * TypeORM 命名参数 + `::interval` 转换下：
 * 1. AWAITING_SHIPMENT 超过短阈值即入选；
 * 2. IN_TRANSIT 同样在短阈值内、长阈值外时按中档判定（不被短档提前选中）；
 * 3. NULL/DELIVERED（ERP 未终态）只在最慢档到期后入选；
 * 4. 刚回读过的订单（三档都未到期）不入选。
 */
const STORE_CODE = 'OZON-A';
const PREFIX = 'IT-REFRESH-STAGE-';

interface FixtureRow {
  orderNo: string;
  platformStage: string | null;
  erpStatus: string;
  /** platform_facts_checked_at 距现在的分钟数。 */
  ageMinutes: number;
}

const FIXTURES: FixtureRow[] = [
  // 短档命中：未交平台、3 小时没回读。
  {
    orderNo: `${PREFIX}AWAITING-DUE`,
    platformStage: 'AWAITING_SHIPMENT',
    erpStatus: 'NEW',
    ageMinutes: 180,
  },
  // 短档不该命中（20 分钟），但中档（12h）也未到期 → 不应入选。
  {
    orderNo: `${PREFIX}AWAITING-FRESH`,
    platformStage: 'AWAITING_SHIPMENT',
    erpStatus: 'NEW',
    ageMinutes: 20,
  },
  // 中档命中：运输中、13 小时没回读（短档 2h 也会命中；用下面一条反证分档）。
  {
    orderNo: `${PREFIX}TRANSIT-DUE`,
    platformStage: 'IN_TRANSIT',
    erpStatus: 'NEW',
    ageMinutes: 13 * 60,
  },
  // 中档未到期、慢档也未到期：运输中 3 小时 → 不应入选（若被短档误判则会入选）。
  {
    orderNo: `${PREFIX}TRANSIT-NOT-DUE`,
    platformStage: 'IN_TRANSIT',
    erpStatus: 'NEW',
    ageMinutes: 180,
  },
  // 慢档命中：阶段未知、25 小时。
  { orderNo: `${PREFIX}UNKNOWN-DUE`, platformStage: null, erpStatus: 'NEW', ageMinutes: 25 * 60 },
  // 慢档未到期：阶段未知、3 小时 → 不应入选。
  { orderNo: `${PREFIX}UNKNOWN-NOT-DUE`, platformStage: null, erpStatus: 'NEW', ageMinutes: 180 },
];

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: false,
  entities: [OrderEntity, OrderItemEntity],
});

let storeId = '';

beforeAll(async () => {
  await dataSource.initialize();
  const stores = await dataSource.query<Array<{ id: string }>>(
    `SELECT id FROM stores WHERE store_code = $1 LIMIT 1`,
    [STORE_CODE],
  );
  const found = stores[0];
  if (found === undefined) {
    throw new Error(`integration fixture store ${STORE_CODE} missing`);
  }
  storeId = found.id;

  await dataSource.query(`DELETE FROM orders WHERE platform_order_id LIKE $1`, [`${PREFIX}%`]);
  let seq = 0;
  for (const fixture of FIXTURES) {
    seq += 1;
    await dataSource.query(
      `INSERT INTO orders
         (order_no, store_id, platform_order_id, platform_stage, erp_status,
          ordered_at, platform_facts_checked_at, sync_source)
       VALUES ($1, $2, $3, $4, $5, now(), now() - ($6 || ' minutes')::interval, 'POLLING')`,
      [
        `${PREFIX}${String(seq).padStart(3, '0')}`,
        storeId,
        fixture.orderNo,
        fixture.platformStage,
        fixture.erpStatus,
        String(fixture.ageMinutes),
      ],
    );
  }
});

afterAll(async () => {
  if (dataSource.isInitialized) {
    await dataSource.query(`DELETE FROM orders WHERE platform_order_id LIKE $1`, [`${PREFIX}%`]);
    await dataSource.destroy();
  }
});

async function candidates(hours: {
  awaitingShipment: number;
  inTransit: number;
  delivered: number;
}): Promise<string[]> {
  const repository = new OrderRepository(dataSource);
  const rows = await repository.listPlatformRefreshCandidates(storeId, { limit: 200, hours });
  const ids = new Set(rows.map((row) => row.id));
  const fixtures = await dataSource.query<Array<{ id: string; platform_order_id: string }>>(
    `SELECT id, platform_order_id FROM orders WHERE platform_order_id LIKE $1`,
    [`${PREFIX}%`],
  );
  return fixtures
    .filter((row) => ids.has(row.id))
    .map((row) => row.platform_order_id.replace(PREFIX, ''))
    .sort();
}

describe('listPlatformRefreshCandidates 分阶段阈值', () => {
  it('默认 2h/12h/24h：各阶段只按自己的档位到期', async () => {
    const selected = await candidates({ awaitingShipment: 2, inTransit: 12, delivered: 24 });
    expect(selected).toEqual(['AWAITING-DUE', 'TRANSIT-DUE', 'UNKNOWN-DUE']);
  });

  it('放长 AWAITING_SHIPMENT 档后，未到期的待发货单不再入选', async () => {
    const selected = await candidates({ awaitingShipment: 6, inTransit: 12, delivered: 24 });
    expect(selected).toEqual(['TRANSIT-DUE', 'UNKNOWN-DUE']);
  });

  it('三档统一放大到 48h：全部未到期，一条都不选', async () => {
    const selected = await candidates({ awaitingShipment: 48, inTransit: 48, delivered: 48 });
    expect(selected).toEqual([]);
  });

  it('分档确实生效：运输中 3h 只在短档 ≤3h 时入选', async () => {
    const short = await candidates({ awaitingShipment: 2, inTransit: 3, delivered: 24 });
    expect(short).toContain('TRANSIT-NOT-DUE');
    const staged = await candidates({ awaitingShipment: 2, inTransit: 12, delivered: 24 });
    expect(staged).not.toContain('TRANSIT-NOT-DUE');
  });
});
