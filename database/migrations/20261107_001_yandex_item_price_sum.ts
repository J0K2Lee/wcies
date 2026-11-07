import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Yandex 订单金额口径修正（2026-11-07 用户口径）：
 *
 * `order_items.unit_price` 应为 `raw_data.prices` 下**所有金额项之和**
 * （payment / cashback / subsidy / delivery…，忽略 `vat` 等非金额字段），
 * 取代 2026-10-24 的 `payment + cashback`。
 *
 * 实测：payment 387.61 + subsidy 129.14 + cashback 3.26 = 520.01，旧口径只算
 * 390.87。本次按 raw_data 重算存量（267 行全部受影响），total_price 随
 * quantity 同步；只用字符串/JSON 运算，不依赖应用代码。
 *
 * 幂等：只更新与目标值不一致的行；没有金额项的行（goods IS NULL）跳过。
 */
export class YandexItemPriceSum1794100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH src AS (
        SELECT oi.id,
               oi.quantity,
               (SELECT SUM((entry.value ->> 'value')::numeric)
                  FROM jsonb_each(oi.raw_data -> 'prices') AS entry
                 WHERE jsonb_typeof(entry.value) = 'object'
                   AND entry.value ? 'value'
                   AND (entry.value ->> 'value') ~ '^[0-9]+(\.[0-9]+)?$') AS goods
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN stores s ON s.id = o.store_id
          JOIN platforms p ON p.id = s.platform_id
         WHERE p.code = 'YANDEX'
           AND oi.raw_data ? 'prices'
      )
      UPDATE order_items oi
         SET unit_price = ROUND(src.goods, 2),
             total_price = ROUND(src.goods * src.quantity, 2)
        FROM src
       WHERE oi.id = src.id
         AND src.goods IS NOT NULL
         AND (oi.unit_price IS DISTINCT FROM ROUND(src.goods, 2)
              OR oi.total_price IS DISTINCT FROM ROUND(src.goods * src.quantity, 2))
    `);
  }

  public async down(): Promise<void> {
    // 金额口径修正不可逆：旧值（payment+cashback）已无业务意义，恢复旧口径
    // 需要从 raw_data 重算，且不应作为回滚目标。保留空实现。
  }
}
