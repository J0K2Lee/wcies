import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 3: order interceptions (task §56-§57).
 *
 * Created when a PICKED order line is cancelled - the physical item must be
 * found and returned; stock is NEVER auto-restored on cancel (AGENTS.md §42).
 * Sprint 3 implements creation (CREATED) only.
 */
export class CreateOrderInterceptions1789002000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE order_interception_no_seq START 1`);
    await queryRunner.createTable(
      new Table({
        name: 'order_interceptions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'interception_no', type: 'varchar', length: 30, isNullable: false },
          { name: 'order_id', type: 'uuid', isNullable: false },
          { name: 'order_item_id', type: 'uuid', isNullable: true },
          { name: 'warehouse_id', type: 'uuid', isNullable: false },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'CREATED'` },
          { name: 'reason', type: 'text', isNullable: true },
          { name: 'assigned_to', type: 'uuid', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'assigned_at', type: 'timestamptz', isNullable: true },
          { name: 'intercepted_at', type: 'timestamptz', isNullable: true },
          { name: 'returned_to_stock_at', type: 'timestamptz', isNullable: true },
          { name: 'closed_at', type: 'timestamptz', isNullable: true },
        ],
        uniques: [new TableUnique({ name: 'uq_order_interceptions_no', columnNames: ['interception_no'] })],
        indices: [
          new TableIndex({ name: 'idx_order_interceptions_order', columnNames: ['order_id'] }),
          new TableIndex({ name: 'idx_order_interceptions_status', columnNames: ['status'] }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_order_interceptions_status',
            expression:
              "status IN ('CREATED', 'ASSIGNED', 'LOCATING', 'INTERCEPTED', 'FAILED', 'RETURNED_TO_STOCK', 'CLOSED')",
          }),
        ],
        foreignKeys: [
          {
            name: 'fk_order_interceptions_order',
            columnNames: ['order_id'],
            referencedTableName: 'orders',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_order_interceptions_order_item',
            columnNames: ['order_item_id'],
            referencedTableName: 'order_items',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_order_interceptions_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('order_interceptions');
    await queryRunner.query(`DROP SEQUENCE IF EXISTS order_interception_no_seq`);
  }
}
