import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 外部履约标记（2026-10-23 用户需求）。
 *
 * 「标记外部履约」此前只把行置 RELEASED、订单转 SHIPPED，没有任何落库标记——
 * 于是无法回答「这张已发货单是我手工关账的外部履约，还是真的出库了」，
 * 也就没法提供「取消外部履约」的反向操作。
 *
 * 这里补两个只增不删的字段：
 *   - external_fulfilled_at：标记时间，NULL = 从未标记；
 *   - external_fulfillment_reason：标记时填的原因（审计/回显）。
 *
 * 历史数据不回填：之前标记过的单与真正出库的单已经无法区分，按「未标记」处理
 * （这些单本来也没有取消入口，行为与改造前一致）。
 */
export class OrderExternalFulfillmentMark1792760000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS external_fulfilled_at timestamptz,
        ADD COLUMN IF NOT EXISTS external_fulfillment_reason varchar(500)
    `);
    // 取消入口按「已标记 + 店铺+时间」查，量很小；仅给已标记行建部分索引，
    // 不给全表加负但。
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_external_fulfilled
        ON orders (external_fulfilled_at)
        WHERE external_fulfilled_at IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_orders_external_fulfilled`);
    await queryRunner.query(`
      ALTER TABLE orders
        DROP COLUMN IF EXISTS external_fulfillment_reason,
        DROP COLUMN IF EXISTS external_fulfilled_at
    `);
  }
}
