import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Sprint 3: order status history (task §9 / §82).
 *
 * EVERY erp_status change must leave a row here - writing orders.erp_status
 * without history is an architecture violation (AGENTS.md §39).
 */
export class CreateOrderStatusHistory1789002000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'order_status_history',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'order_id', type: 'uuid', isNullable: false },
          { name: 'from_status', type: 'varchar', length: 40, isNullable: true },
          { name: 'to_status', type: 'varchar', length: 40, isNullable: false },
          { name: 'reason', type: 'varchar', length: 500, isNullable: true },
          { name: 'operator_id', type: 'uuid', isNullable: true },
          { name: 'operator_name', type: 'varchar', length: 100, isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        indices: [
          new TableIndex({ name: 'idx_order_status_history_order', columnNames: ['order_id', 'created_at'] }),
        ],
        foreignKeys: [
          {
            name: 'fk_order_status_history_order',
            columnNames: ['order_id'],
            referencedTableName: 'orders',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('order_status_history');
  }
}
