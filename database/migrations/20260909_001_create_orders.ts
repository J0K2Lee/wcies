import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 3: orders HEADER (task §4).
 *
 * Business uniqueness is (store_id, platform_order_id) - platform order ids
 * may repeat across stores (AGENTS.md §35). order_no (ORD%08d) is an
 * internal display number only. platform_status is stored as a fact and is
 * NEVER copied into erp_status (AGENTS.md §38).
 */
export class CreateOrders1789002000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE order_no_seq START 1`);
    await queryRunner.createTable(
      new Table({
        name: 'orders',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'order_no', type: 'varchar', length: 30, isNullable: false },
          { name: 'store_id', type: 'uuid', isNullable: false },
          { name: 'platform_order_id', type: 'varchar', length: 255, isNullable: false },
          { name: 'platform_status', type: 'varchar', length: 64, isNullable: true },
          { name: 'erp_status', type: 'varchar', length: 40, isNullable: false },
          { name: 'fulfillment_mode', type: 'varchar', length: 40, isNullable: true },
          { name: 'currency', type: 'varchar', length: 10, isNullable: true },
          { name: 'ordered_at', type: 'timestamptz', isNullable: false },
          { name: 'raw_data', type: 'jsonb', isNullable: true },
          { name: 'remark', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({ name: 'uq_orders_no', columnNames: ['order_no'] }),
          new TableUnique({ name: 'uq_orders_store_platform', columnNames: ['store_id', 'platform_order_id'] }),
        ],
        indices: [
          new TableIndex({ name: 'idx_orders_erp_status', columnNames: ['erp_status'] }),
          new TableIndex({ name: 'idx_orders_store', columnNames: ['store_id'] }),
          new TableIndex({ name: 'idx_orders_ordered_at', columnNames: ['ordered_at'] }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_orders_status_not_blank',
            expression: "length(btrim(erp_status)) > 0 AND length(btrim(platform_order_id)) > 0",
          }),
        ],
        foreignKeys: [
          {
            name: 'fk_orders_store',
            columnNames: ['store_id'],
            referencedTableName: 'stores',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('orders');
    await queryRunner.query(`DROP SEQUENCE IF EXISTS order_no_seq`);
  }
}
