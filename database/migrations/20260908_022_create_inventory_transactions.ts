import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableUnique } from 'typeorm';

/**
 * Sprint 2: inventory TRANSACTIONS - the immutable ledger lines
 * (task §16-§17).
 *
 * quantity_* track On Hand; reserved_* / picked_* are populated when the
 * action moves them and stay NULL otherwise. Lines hang off an
 * inventory_event; the per-line idempotency_key is
 * `<event idempotency key>#<line no>` so multi-line events never collide.
 * No DELETE API exists for these rows (task §77).
 */
export class CreateInventoryTransactions1789000800022 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'inventory_transactions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'transaction_no', type: 'varchar', length: 40, isNullable: false },
          { name: 'event_id', type: 'uuid', isNullable: false },
          { name: 'sku_id', type: 'uuid', isNullable: false },
          { name: 'warehouse_id', type: 'uuid', isNullable: false },
          { name: 'bin_id', type: 'uuid', isNullable: false },
          { name: 'transaction_type', type: 'varchar', length: 40, isNullable: false },
          { name: 'quantity_before', type: 'numeric', precision: 18, scale: 3, isNullable: false },
          { name: 'quantity_change', type: 'numeric', precision: 18, scale: 3, isNullable: false },
          { name: 'quantity_after', type: 'numeric', precision: 18, scale: 3, isNullable: false },
          { name: 'reserved_before', type: 'numeric', precision: 18, scale: 3, isNullable: true },
          { name: 'reserved_change', type: 'numeric', precision: 18, scale: 3, isNullable: true },
          { name: 'reserved_after', type: 'numeric', precision: 18, scale: 3, isNullable: true },
          { name: 'picked_before', type: 'numeric', precision: 18, scale: 3, isNullable: true },
          { name: 'picked_change', type: 'numeric', precision: 18, scale: 3, isNullable: true },
          { name: 'picked_after', type: 'numeric', precision: 18, scale: 3, isNullable: true },
          { name: 'reference_type', type: 'varchar', length: 30, isNullable: false },
          { name: 'reference_id', type: 'uuid', isNullable: false },
          { name: 'idempotency_key', type: 'varchar', length: 220, isNullable: false },
          { name: 'operator_id', type: 'uuid', isNullable: true },
          { name: 'remark', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({ name: 'uq_inventory_transactions_no', columnNames: ['transaction_no'] }),
          new TableUnique({ name: 'uq_inventory_transactions_idem', columnNames: ['idempotency_key'] }),
        ],
        foreignKeys: [
          {
            name: 'fk_inventory_transactions_event',
            columnNames: ['event_id'],
            referencedTableName: 'inventory_events',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_transactions_sku',
            columnNames: ['sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_transactions_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_transactions_bin',
            columnNames: ['bin_id'],
            referencedTableName: 'warehouse_bins',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_inventory_transactions_operator',
            columnNames: ['operator_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('inventory_transactions');
  }
}
