import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 4: shipments (task §7-§9/§14).
 *
 * Order 1:N Shipment - one shipment belongs to exactly ONE warehouse (an
 * order fulfilled from two warehouses must split into two shipments, matching
 * the 1 PickingTask = 1 Warehouse rule). The status set is the warehouse
 * fulfillment ladder, NOT a logistics-track status.
 */
export class CreateShipments1789088400001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE shipment_no_seq START 1`);
    await queryRunner.createTable(
      new Table({
        name: 'shipments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'shipment_no', type: 'varchar', length: 30, isNullable: false },
          { name: 'order_id', type: 'uuid', isNullable: false },
          { name: 'warehouse_id', type: 'uuid', isNullable: false },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'READY_TO_PACK'` },
          { name: 'shipping_method', type: 'varchar', length: 100, isNullable: true },
          { name: 'tracking_number', type: 'varchar', length: 255, isNullable: true },
          { name: 'carrier_code', type: 'varchar', length: 100, isNullable: true },
          { name: 'external_shipment_id', type: 'varchar', length: 255, isNullable: true },
          { name: 'shipped_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [new TableUnique({ name: 'uq_shipments_no', columnNames: ['shipment_no'] })],
        indices: [
          new TableIndex({ name: 'idx_shipments_order', columnNames: ['order_id'] }),
          new TableIndex({ name: 'idx_shipments_warehouse', columnNames: ['warehouse_id'] }),
          new TableIndex({ name: 'idx_shipments_status', columnNames: ['status'] }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_shipments_status',
            expression:
              "status IN ('DRAFT', 'READY_TO_PACK', 'PACKING', 'READY_TO_SHIP', 'SHIPPED', 'CANCELLED', 'EXCEPTION')",
          }),
        ],
        foreignKeys: [
          {
            name: 'fk_shipments_order',
            columnNames: ['order_id'],
            referencedTableName: 'orders',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_shipments_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('shipments');
    await queryRunner.query(`DROP SEQUENCE IF EXISTS shipment_no_seq`);
  }
}
