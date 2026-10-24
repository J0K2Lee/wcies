/**
 * 一次性数据回填（2026-10-24）：补齐 WB / Yandex 订单的单价与币种。
 *
 * 背景：两个 mapper 此前从来没映射价格——
 * - Yandex：`unitPrice` 写死 null、`currency` null（T0 占位，一直没实现）；
 * - WB：取了 v3 `/orders` 里并不存在的 `finalPrice`/`salePrice`，而实际字段是
 *   `price`（以「分」计价，官方 spec: multiplied by 100）；`currencyCode` 是 ISO
 *   数字码 643，未归一化。
 *
 * 新单由 mapper 修复后的精确值写入；本脚本按**原始报文**回填历史单：
 * - Yandex：单价 = `prices.payment.value + prices.cashback.value`（官方口径；
 *   `subsidy` 是卖家奖励，不计入商品金额）；币种 `RUR` → `RUB`。
 * - WB：单价 = `price / 100`；币种 `643` → `RUB`。
 * - 行金额 = 单价 × 数量（与摄入时一致）。
 *
 * 用法：
 *   npx tsx --env-file=.env scripts/backfill-order-prices-2026-10-24.ts
 *   npx tsx --env-file=.env scripts/backfill-order-prices-2026-10-24.ts --execute
 */
import { Client } from 'pg';

const EXECUTE = process.argv.includes('--execute');
const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined || connectionString === '') {
  throw new Error('需要 DATABASE_URL');
}
if (!connectionString.includes('wcies_dev') && !connectionString.includes('wcies_test')) {
  throw new Error('拒绝执行：只允许 wcies_dev / wcies_test（生产环境默认拒绝，AGENTS §93）');
}

const ISO_NUMERIC_CURRENCIES: Record<string, string> = {
  '643': 'RUB',
  '810': 'RUB',
  '156': 'CNY',
  '840': 'USD',
  '978': 'EUR',
  '398': 'KZT',
  '933': 'BYN',
};

function normalizeCurrency(raw: unknown): string | null {
  // WB 的 currencyCode 在报文里是数字（643），不能只接受 string。
  const value =
    typeof raw === 'number' && Number.isFinite(raw)
      ? String(raw)
      : typeof raw === 'string' && raw !== ''
        ? raw
        : null;
  if (value === null) {
    return null;
  }
  const mapped = ISO_NUMERIC_CURRENCIES[value];
  if (mapped !== undefined) {
    return mapped;
  }
  const upper = value.toUpperCase();
  return upper === 'RUR' ? 'RUB' : upper;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function readMoney(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  return num((raw as Record<string, unknown>)['value']);
}

/** Yandex：商品金额 = payment + cashback（subsidy 不算）。 */
function yandexUnitPrice(itemRaw: Record<string, unknown>): string | null {
  const prices = itemRaw['prices'];
  if (typeof prices !== 'object' || prices === null) {
    return null;
  }
  const bag = prices as Record<string, unknown>;
  const payment = readMoney(bag['payment']);
  if (payment === null) {
    return null;
  }
  return (payment + (readMoney(bag['cashback']) ?? 0)).toFixed(2);
}

/** WB：price 以分计价。 */
function wbUnitPrice(itemRaw: Record<string, unknown>): string | null {
  const price = num(itemRaw['price']);
  return price === null ? null : (price / 100).toFixed(2);
}

interface ItemRow {
  id: string;
  order_id: string;
  platform: string;
  quantity: string;
  unit_price: string | null;
  total_price: string | null;
  item_raw: Record<string, unknown>;
  order_currency: string | null;
  order_raw: Record<string, unknown>;
  order_no: string;
}

interface Planned {
  itemId: string;
  orderId: string;
  orderNo: string;
  platform: string;
  before: string | null;
  after: string;
  total: string;
}

function planItems(rows: readonly ItemRow[]): {
  items: Planned[];
  currencies: Array<{ orderId: string; orderNo: string; before: string | null; after: string }>;
} {
  const items: Planned[] = [];
  const currencyById = new Map<
    string,
    { orderId: string; orderNo: string; before: string | null; after: string }
  >();

  for (const row of rows) {
    const unit =
      row.platform === 'YANDEX' ? yandexUnitPrice(row.item_raw) : wbUnitPrice(row.item_raw);
    if (unit !== null && row.unit_price === null) {
      const quantity = Number(row.quantity);
      items.push({
        itemId: row.id,
        orderId: row.order_id,
        orderNo: row.order_no,
        platform: row.platform,
        before: row.unit_price,
        after: unit,
        total: (Number(unit) * quantity).toFixed(4),
      });
    }
    if (row.order_currency === null || /^\d+$/.test(row.order_currency)) {
      const raw =
        row.platform === 'YANDEX'
          ? (
              (row.order_raw['prices'] as Record<string, unknown> | undefined)?.['payment'] as
                Record<string, unknown> | undefined
            )?.['currencyId']
          : row.order_raw['currencyCode'];
      const normalized = normalizeCurrency(raw);
      if (normalized !== null && !currencyById.has(row.order_id)) {
        currencyById.set(row.order_id, {
          orderId: row.order_id,
          orderNo: row.order_no,
          before: row.order_currency,
          after: normalized,
        });
      }
    }
  }
  return { items, currencies: [...currencyById.values()] };
}

async function main(): Promise<void> {
  const db = new Client({ connectionString });
  await db.connect();
  try {
    const rows = (
      await db.query<ItemRow>(
        `SELECT i.id, i.order_id, p.code AS platform, i.quantity::text AS quantity,
                i.unit_price::text AS unit_price, i.total_price::text AS total_price,
                i.raw_data AS item_raw, o.currency AS order_currency,
                o.raw_data AS order_raw, o.order_no
           FROM order_items i
           JOIN orders o ON o.id = i.order_id
           JOIN stores st ON st.id = o.store_id
           JOIN platforms p ON p.id = st.platform_id
          WHERE p.code IN ('YANDEX', 'WB')
          ORDER BY o.order_no, i.line_no`,
      )
    ).rows;

    const plan = planItems(rows);
    console.log(
      `扫描 ${rows.length} 行（YANDEX/WB）：待补单价 ${plan.items.length} 行、待修币种 ${plan.currencies.length} 张订单。\n`,
    );
    console.log('单价样本：');
    for (const item of plan.items.slice(0, 10)) {
      console.log(
        `  ${item.orderNo} ${item.platform.padEnd(7)} ${String(item.before)} → ${item.after}（小计 ${item.total}）`,
      );
    }
    console.log('\n币种样本：');
    for (const ccy of plan.currencies.slice(0, 10)) {
      console.log(`  ${ccy.orderNo} ${String(ccy.before)} → ${ccy.after}`);
    }
    const byPlatform = new Map<string, number>();
    for (const item of plan.items) {
      byPlatform.set(item.platform, (byPlatform.get(item.platform) ?? 0) + 1);
    }
    console.log('\n按平台：', JSON.stringify([...byPlatform]));

    if (!EXECUTE) {
      console.log('\n[dry-run] 加 --execute 执行。');
      return;
    }

    await db.query('BEGIN');
    try {
      for (const item of plan.items) {
        await db.query(
          `UPDATE order_items SET unit_price = $2::numeric, total_price = $3::numeric WHERE id = $1::uuid`,
          [item.itemId, item.after, item.total],
        );
      }
      for (const ccy of plan.currencies) {
        await db.query(`UPDATE orders SET currency = $2, updated_at = now() WHERE id = $1::uuid`, [
          ccy.orderId,
          ccy.after,
        ]);
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    console.log(`\n已回填：单价 ${plan.items.length} 行、币种 ${plan.currencies.length} 张订单。`);
  } finally {
    await db.end();
  }
}

void main();
