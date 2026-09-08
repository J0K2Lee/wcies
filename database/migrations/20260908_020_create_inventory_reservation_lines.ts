import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Sprint 2: reservation LINES - the per-bin allocations of one reservation
 * header (task §25-§26). picked_qty exists so partial pick can be added in a
 * later sprint without a schema change (task §32); Sprint 2 API requires
 * full-reservation pick.
 */
export class CreateInventoryReservationLines1789000800020 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'inventory_reservation_lines',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'reservation_id', type: 'uuid', isNullable: false },
          { name: 'bin_id', type: 'uuid', isNullable: false },
          { name: 'quantity', type: 'numeric', precision: 18, scale: 3, isNullable: false },
          { name: 'picked_qty', type: 'numeric', precision: 18, scale: 3, isNullable: false, default: '0' },
          { name: 'status', type: 'varchar', length: 30, isNullable: false },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        checks: [
          new TableCheck({
            name: 'ck_inventory_reservation_lines_qty',
            expression: 'quantity > 0 AND picked_qty >= 0 AND picked_qty <= quantity',
          }),
        ],
        foreignKeys: [
          {
            name: 'fk_inventory_reservation_lines_reservation',
            columnNames: ['reservation_id'],
            referencedTableName: 'inventory_reservations',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_reservation_lines_bin',
            columnNames: ['bin_id'],
            referencedTableName: 'warehouse_bins',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'inventory_reservation_lines',
      new TableIndex({ name: 'idx_inventory_reservation_lines_reservation', columnNames: ['reservation_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('inventory_reservation_lines');
  }
}
