import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 4: shipment items (task §13/§16).
 *
 * Snapshot of what ONE shipment must send: the PICKED order lines captured at
 * shipment creation. Package completeness is validated against this snapshot
 * (packed totals must equal it exactly) and the ship transaction consumes
 * exactly this quantity per line. UNIQUE(order_item_id) globally: a line can
 * be assigned to at most one non-cancelled shipment; the row is removed when
 * an interception returns the line to stock (task §43).
 */
export class CreateShipmentItems1789088400002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'shipment_items',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'shipment_id', type: 'uuid', isNullable: false },
          { name: 'order_item_id', type: 'uuid', isNullable: false },
          { name: 'sku_id', type: 'uuid', isNullable: false },
          { name: 'reservation_id', type: 'uuid', isNullable: false },
          { name: 'quantity', type: 'numeric', precision: 18, scale: 3, isNullable: false },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({ name: 'uq_shipment_items_shipment_order_item', columnNames: ['shipment_id', 'order_item_id'] }),
          new TableUnique({ name: 'uq_shipment_items_order_item', columnNames: ['order_item_id'] }),
        ],
        indices: [
          new TableIndex({ name: 'idx_shipment_items_shipment', columnNames: ['shipment_id'] }),
          new TableIndex({ name: 'idx_shipment_items_sku', columnNames: ['sku_id'] }),
        ],
        checks: [new TableCheck({ name: 'ck_shipment_items_qty_positive', expression: 'quantity > 0' })],
        foreignKeys: [
          {
            name: 'fk_shipment_items_shipment',
            columnNames: ['shipment_id'],
            referencedTableName: 'shipments',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'fk_shipment_items_order_item',
            columnNames: ['order_item_id'],
            referencedTableName: 'order_items',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_shipment_items_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_shipment_items_reservation',
            columnNames: ['reservation_id'],
            referencedTableName: 'inventory_reservations',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('shipment_items');
  }
}
