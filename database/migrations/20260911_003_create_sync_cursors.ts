import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Sprint 5 task §13: per (store_id, sync_type) cursor.
 *
 * NEVER platform-level shared cursors (task §46): each store walks its own
 * window. cursor_data is opaque to the schema - the adapter interprets it.
 * consecutive_failures feeds the store sync tab and scheduler backoff.
 */
export class CreateSyncCursors1790000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'sync_cursors',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'gen_random_uuid()' },
          { name: 'store_id', type: 'uuid', isNullable: false },
          { name: 'sync_type', type: 'varchar', length: 40, isNullable: false },
          { name: 'cursor_data', type: 'jsonb', isNullable: true },
          { name: 'last_success_at', type: 'timestamptz', isNullable: true },
          { name: 'consecutive_failures', type: 'integer', isNullable: false, default: "'0'" },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        foreignKeys: [
          {
            name: 'fk_sync_cursors_store',
            columnNames: ['store_id'],
            referencedTableName: 'stores',
            referencedColumnNames: ['id'],
          },
        ],
        checks: [
          {
            name: 'ck_sync_cursors_sync_type',
            expression: `sync_type IN ('LISTING_SYNC', 'ORDER_SYNC')`,
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'sync_cursors',
      new TableIndex({
        name: 'uq_sync_cursors_store_type',
        columnNames: ['store_id', 'sync_type'],
        unique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('sync_cursors', true);
  }
}
