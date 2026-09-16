import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 10 T1 (docs/business-rules/finance.md §2): platform-reported line
 * amounts become structured facts on order_items.
 *
 * - unit_price: platform unit sale price (OZON posting products[].price, a
 *   verified field - docs/integrations/ozon.md); NULL when the platform gave
 *   none (never guessed as 0);
 * - total_price: unit_price × quantity, computed at write time.
 *
 * Backfill is idempotent and strictly regex-guarded: an item whose raw_data
 * carries no valid price keeps NULL and is counted, never guessed
 * (AGENTS.md §88/§89).
 */
export class AddOrderItemPrices1791600001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE order_items ADD COLUMN unit_price numeric(18,4) NULL`);
    await queryRunner.query(`ALTER TABLE order_items ADD COLUMN total_price numeric(18,4) NULL`);

    await queryRunner.query(`
      UPDATE order_items
         SET unit_price = (raw_data->>'price')::numeric(18,4),
             total_price = ROUND((raw_data->>'price')::numeric(18,4) * quantity, 4)
       WHERE unit_price IS NULL
         AND raw_data->>'price' ~ '^\\d{1,14}(\\.\\d{1,4})?$'`);

    await queryRunner.query(
      `CREATE INDEX idx_order_items_order_price ON order_items (order_id) WHERE unit_price IS NOT NULL`,
    );

    // Audit trail (AGENTS.md §89): missing-price facts stay visible.
    const counts = (await queryRunner.query(
      `SELECT
          COUNT(*) FILTER (WHERE unit_price IS NOT NULL) AS priced,
          COUNT(*) FILTER (WHERE unit_price IS NULL) AS missing
       FROM order_items`,
    )) as Array<{ priced: string; missing: string }>;
    const row = counts[0];
    // eslint-disable-next-line no-console
    console.log(
      `[migration add_order_item_prices] priced=${row?.priced ?? 0} missing=${row?.missing ?? 0}`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_order_items_order_price`);
    await queryRunner.query(`ALTER TABLE order_items DROP COLUMN total_price`);
    await queryRunner.query(`ALTER TABLE order_items DROP COLUMN unit_price`);
  }
}
