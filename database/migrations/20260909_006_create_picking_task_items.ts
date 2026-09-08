import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 3: picking task ITEMS (task §29/§31/§39-§40).
 *
 * order_item_id is UNIQUE: an order line is picked by at most one task.
 * DB CHECK picked_qty <= required_qty hard-stops over-picking even under
 * concurrent scans (task §85).
 */
export class CreatePickingTaskItems1789002000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'picking_task_items',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'picking_task_id', type: 'uuid', isNullable: false },
          { name: 'order_id', type: 'uuid', isNullable: false },
          { name: 'order_item_id', type: 'uuid', isNullable: false },
          { name: 'sku_id', type: 'uuid', isNullable: false },
          { name: 'reservation_id', type: 'uuid', isNullable: false },
          { name: 'required_qty', type: 'numeric', precision: 18, scale: 3, isNullable: false },
          { name: 'picked_qty', type: 'numeric', precision: 18, scale: 3, isNullable: false, default: '0' },
          { name: 'status', type: 'varchar', length: 20, isNullable: false, default: `'PENDING'` },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [new TableUnique({ name: 'uq_picking_task_items_order_item', columnNames: ['order_item_id'] })],
        indices: [
          new TableIndex({ name: 'idx_picking_task_items_task', columnNames: ['picking_task_id'] }),
          new TableIndex({ name: 'idx_picking_task_items_order', columnNames: ['order_id'] }),
          new TableIndex({ name: 'idx_picking_task_items_sku', columnNames: ['sku_id'] }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_picking_task_items_qty',
            expression: 'required_qty > 0 AND picked_qty >= 0 AND picked_qty <= required_qty',
          }),
          new TableCheck({
            name: 'ck_picking_task_items_status',
            expression: "status IN ('PENDING', 'PICKED')",
          }),
        ],
        foreignKeys: [
          {
            name: 'fk_picking_task_items_task',
            columnNames: ['picking_task_id'],
            referencedTableName: 'picking_tasks',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_picking_task_items_order',
            columnNames: ['order_id'],
            referencedTableName: 'orders',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_picking_task_items_order_item',
            columnNames: ['order_item_id'],
            referencedTableName: 'order_items',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_picking_task_items_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_picking_task_items_reservation',
            columnNames: ['reservation_id'],
            referencedTableName: 'inventory_reservations',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('picking_task_items');
  }
}
