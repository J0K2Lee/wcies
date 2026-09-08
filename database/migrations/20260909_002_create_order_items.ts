import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 3: order ITEMS (task §6-§8).
 *
 * Each line keeps its own mapping_status (PENDING/MAPPED/FAILED - guessing a
 * SKU is forbidden) and fulfillment_status (PENDING/RESERVED/BACKORDERED/
 * PICKED/RELEASED). reservation_id links the line to its InventoryReservation
 * (referenceType=ORDER, referenceId=order_item.id, key ORDER_RESERVE:<itemId>).
 */
export class CreateOrderItems1789002000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'order_items',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'order_id', type: 'uuid', isNullable: false },
          { name: 'line_no', type: 'integer', isNullable: false },
          { name: 'platform_product_id', type: 'varchar', length: 255, isNullable: true },
          { name: 'platform_sku_id', type: 'varchar', length: 255, isNullable: true },
          { name: 'seller_sku', type: 'varchar', length: 255, isNullable: true },
          { name: 'offer_id', type: 'varchar', length: 255, isNullable: true },
          { name: 'listing_sku_id', type: 'uuid', isNullable: true },
          { name: 'sku_id', type: 'uuid', isNullable: true },
          { name: 'warehouse_id', type: 'uuid', isNullable: true },
          { name: 'quantity', type: 'numeric', precision: 18, scale: 3, isNullable: false },
          { name: 'fulfillment_status', type: 'varchar', length: 30, isNullable: false },
          { name: 'mapping_status', type: 'varchar', length: 30, isNullable: false },
          { name: 'reservation_id', type: 'uuid', isNullable: true },
          { name: 'raw_data', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [new TableUnique({ name: 'uq_order_items_order_line', columnNames: ['order_id', 'line_no'] })],
        indices: [
          new TableIndex({ name: 'idx_order_items_order', columnNames: ['order_id'] }),
          new TableIndex({ name: 'idx_order_items_sku', columnNames: ['sku_id'] }),
          new TableIndex({ name: 'idx_order_items_reservation', columnNames: ['reservation_id'] }),
        ],
        checks: [
          new TableCheck({ name: 'ck_order_items_qty_positive', expression: 'quantity > 0' }),
        ],
        foreignKeys: [
          {
            name: 'fk_order_items_order',
            columnNames: ['order_id'],
            referencedTableName: 'orders',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_order_items_listing_sku',
            columnNames: ['listing_sku_id'],
            referencedTableName: 'platform_listing_skus',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_order_items_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_order_items_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_order_items_reservation',
            columnNames: ['reservation_id'],
            referencedTableName: 'inventory_reservations',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('order_items');
  }
}
