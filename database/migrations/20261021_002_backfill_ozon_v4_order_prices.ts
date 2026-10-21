import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * v4 订单列表价格/币种回填（2026-10-21 用户报告）。
 *
 * 背景：2026-10-20 把订单同步从 /v3/posting/fbs/list 迁到 v4（v3 恒 429），
 * v4 的 `products[].price` 从字符串 "1100.0000" 变成对象
 * `{amount: "1100", currency: "CNY"}`，且不再带 `product.currency_code`。
 * 旧 mapper 只接受字符串，于是**轮询摄入**的订单单价/小计为空、币种为空
 * （Webhook 路径走 /v3/posting/fbs/get，仍是字符串，不受影响）。
 *
 * 代码侧已修（本批：mapper 同时接受两种形态并从 price.currency 取币种）。
 * 本迁移修复既有 9 行——价格只在建单时写入，后续事实回读不会补。
 *
 * 口径与订单摄入完全一致（finance.md §2）：
 *   unit_price = round(amount, 4)
 *   total_price = round(amount * quantity, 4)
 * 只处理 unit_price 为空且 raw_data.price 是「对象含合法 amount」的行；
 * 无法解析的行保持 NULL，绝不猜价格。币种只填空值。
 */
export class BackfillOzonV4OrderPrices1792541000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) 单价 + 小计（v4 列表的对象形态）
    await queryRunner.query(`
      UPDATE order_items i
         SET unit_price = round((i.raw_data->'price'->>'amount')::numeric, 4),
             total_price = round((i.raw_data->'price'->>'amount')::numeric * i.quantity, 4)
       WHERE i.unit_price IS NULL
         AND jsonb_typeof(i.raw_data->'price') = 'object'
         AND (i.raw_data->'price'->>'amount') ~ '^[0-9]{1,14}(\\.[0-9]+)?$'
    `);

    // 2) 币种：优先订单原始数据里的 currency_code（后续 get 回读会带回），
    //    否则取订单行 price.currency。只填空值。
    await queryRunner.query(`
      UPDATE orders o
         SET currency = COALESCE(
               NULLIF(o.raw_data->'products'->0->>'currency_code', ''),
               (SELECT NULLIF(i.raw_data->'price'->>'currency', '')
                  FROM order_items i
                 WHERE i.order_id = o.id
                   AND NULLIF(i.raw_data->'price'->>'currency', '') IS NOT NULL
                 LIMIT 1)
             )
       WHERE (o.currency IS NULL OR o.currency = '')
         AND COALESCE(
               NULLIF(o.raw_data->'products'->0->>'currency_code', ''),
               (SELECT NULLIF(i.raw_data->'price'->>'currency', '')
                  FROM order_items i
                 WHERE i.order_id = o.id
                   AND NULLIF(i.raw_data->'price'->>'currency', '') IS NOT NULL
                 LIMIT 1)
             ) IS NOT NULL
    `);
  }

  /**
   * 数据修复不可逆：原始金额仍在 order_items.raw_data.price 里，但不再
   * 自动回退（回退会制造"价格为空"的假象）。如需重跑代码侧修复即可。
   */
  public async down(): Promise<void> {
    // no-op
  }
}
