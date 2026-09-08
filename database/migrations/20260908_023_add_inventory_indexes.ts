import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

/**
 * Sprint 2: audit/query indexes (task §75). Kept minimal and aligned with
 * the actual query paths: reservation status/reference lookups, ledger
 * filtered by sku/warehouse + time or by business reference.
 */
export class AddInventoryIndexes1789000800023 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createIndex(
      'inventory_reservations',
      new TableIndex({ name: 'idx_inventory_reservations_status', columnNames: ['status'] }),
    );
    await queryRunner.createIndex(
      'inventory_reservations',
      new TableIndex({ name: 'idx_inventory_reservations_reference', columnNames: ['reference_type', 'reference_id'] }),
    );
    await queryRunner.createIndex(
      'inventory_reservations',
      new TableIndex({ name: 'idx_inventory_reservations_sku_wh', columnNames: ['sku_id', 'warehouse_id'] }),
    );
    await queryRunner.createIndex(
      'inventory_transactions',
      new TableIndex({ name: 'idx_inventory_transactions_sku_created', columnNames: ['sku_id', 'created_at'] }),
    );
    await queryRunner.createIndex(
      'inventory_transactions',
      new TableIndex({ name: 'idx_inventory_transactions_wh_created', columnNames: ['warehouse_id', 'created_at'] }),
    );
    await queryRunner.createIndex(
      'inventory_transactions',
      new TableIndex({ name: 'idx_inventory_transactions_reference', columnNames: ['reference_type', 'reference_id'] }),
    );
    await queryRunner.createIndex(
      'inventory_transactions',
      new TableIndex({ name: 'idx_inventory_transactions_event', columnNames: ['event_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const indexes = [
      ['inventory_transactions', 'idx_inventory_transactions_event'],
      ['inventory_transactions', 'idx_inventory_transactions_reference'],
      ['inventory_transactions', 'idx_inventory_transactions_wh_created'],
      ['inventory_transactions', 'idx_inventory_transactions_sku_created'],
      ['inventory_reservations', 'idx_inventory_reservations_sku_wh'],
      ['inventory_reservations', 'idx_inventory_reservations_reference'],
      ['inventory_reservations', 'idx_inventory_reservations_status'],
    ] as const;
    for (const [table, index] of indexes.reverse()) {
      await queryRunner.dropIndex(table, index);
    }
  }
}
