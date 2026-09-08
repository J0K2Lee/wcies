import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

/**
 * Sprint 3: cross-cutting query indexes for the order/picking read paths
 * (task §90: no N+1, plain pagination is enough at 20-50 orders/day).
 */
export class AddOrderPickingIndexes1789002000009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createIndex(
      'order_items',
      new TableIndex({ name: 'idx_order_items_fulfillment', columnNames: ['fulfillment_status'] }),
    );
    await queryRunner.createIndex(
      'picking_task_items',
      new TableIndex({ name: 'idx_picking_task_items_status', columnNames: ['status'] }),
    );
    await queryRunner.createIndex(
      'system_exceptions',
      new TableIndex({ name: 'idx_system_exceptions_type', columnNames: ['exception_type'] }),
    );
    await queryRunner.createIndex(
      'orders',
      new TableIndex({ name: 'idx_orders_store_ordered', columnNames: ['store_id', 'ordered_at'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('orders', 'idx_orders_store_ordered');
    await queryRunner.dropIndex('system_exceptions', 'idx_system_exceptions_type');
    await queryRunner.dropIndex('picking_task_items', 'idx_picking_task_items_status');
    await queryRunner.dropIndex('order_items', 'idx_order_items_fulfillment');
  }
}
