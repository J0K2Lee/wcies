import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableUnique } from 'typeorm';

/**
 * Sprint 2: reservation HEADER (task §13, §26).
 *
 * One reservation per business demand (reference_type + reference_id +
 * idempotency_key). Per-bin allocations live in inventory_reservation_lines
 * so one business reservation may span multiple bins (task §25). Sprint 2
 * keeps reservation decoupled from the future Order tables via generic
 * references (task §14).
 */
export class CreateInventoryReservations1789000800019 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE inventory_reservation_no_seq START 1`);
    await queryRunner.createTable(
      new Table({
        name: 'inventory_reservations',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'reservation_no', type: 'varchar', length: 30, isNullable: false },
          { name: 'sku_id', type: 'uuid', isNullable: false },
          { name: 'warehouse_id', type: 'uuid', isNullable: false },
          { name: 'reference_type', type: 'varchar', length: 30, isNullable: false },
          { name: 'reference_id', type: 'uuid', isNullable: false },
          { name: 'requested_qty', type: 'numeric', precision: 18, scale: 3, isNullable: false },
          { name: 'status', type: 'varchar', length: 30, isNullable: false },
          { name: 'idempotency_key', type: 'varchar', length: 200, isNullable: false },
          { name: 'remark', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'picked_at', type: 'timestamptz', isNullable: true },
          { name: 'released_at', type: 'timestamptz', isNullable: true },
          { name: 'consumed_at', type: 'timestamptz', isNullable: true },
        ],
        uniques: [
          new TableUnique({ name: 'uq_inventory_reservations_no', columnNames: ['reservation_no'] }),
          new TableUnique({ name: 'uq_inventory_reservations_idem', columnNames: ['idempotency_key'] }),
        ],
        checks: [
          new TableCheck({ name: 'ck_inventory_reservations_qty_positive', expression: 'requested_qty > 0' }),
        ],
        foreignKeys: [
          {
            name: 'fk_inventory_reservations_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_reservations_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('inventory_reservations');
    await queryRunner.query(`DROP SEQUENCE IF EXISTS inventory_reservation_no_seq`);
  }
}
