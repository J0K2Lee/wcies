import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Sprint 5 task §11/§12: sync job ledger.
 *
 * Every synchronization run is recorded here ("no unrecorded syncs"). The
 * partial unique index is the database-side single-flight guard: at most one
 * PENDING/RUNNING job per (store_id, sync_type) (task §15/§45) - BullMQ is
 * the second, softer guard.
 */
export class CreateSyncJobs1790000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'sync_jobs',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'gen_random_uuid()' },
          { name: 'store_id', type: 'uuid', isNullable: false },
          { name: 'sync_type', type: 'varchar', length: 40, isNullable: false },
          { name: 'status', type: 'varchar', length: 20, isNullable: false, default: "'PENDING'" },
          { name: 'trigger_type', type: 'varchar', length: 20, isNullable: false, default: "'MANUAL'" },
          { name: 'started_at', type: 'timestamptz', isNullable: true },
          { name: 'finished_at', type: 'timestamptz', isNullable: true },
          { name: 'cursor_before', type: 'jsonb', isNullable: true },
          { name: 'cursor_after', type: 'jsonb', isNullable: true },
          { name: 'success_count', type: 'integer', isNullable: false, default: '0' },
          { name: 'failed_count', type: 'integer', isNullable: false, default: '0' },
          { name: 'skipped_count', type: 'integer', isNullable: false, default: '0' },
          { name: 'retry_count', type: 'integer', isNullable: false, default: '0' },
          { name: 'error_code', type: 'varchar', length: 60, isNullable: true },
          { name: 'error_message', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        foreignKeys: [
          {
            name: 'fk_sync_jobs_store',
            columnNames: ['store_id'],
            referencedTableName: 'stores',
            referencedColumnNames: ['id'],
          },
        ],
        checks: [
          {
            name: 'ck_sync_jobs_status',
            expression: `status IN ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED')`,
          },
          {
            name: 'ck_sync_jobs_sync_type',
            expression: `sync_type IN ('LISTING_SYNC', 'ORDER_SYNC')`,
          },
          {
            name: 'ck_sync_jobs_trigger',
            expression: `trigger_type IN ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'RETRY')`,
          },
        ],
      }),
      true,
    );
    // Raw SQL: TypeORM's TableIndex drops the UNIQUE flag when combined
    // with a partial WHERE clause - the single-flight guard MUST be unique.
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_sync_jobs_active ON sync_jobs (store_id, sync_type)
       WHERE status IN ('PENDING', 'RUNNING')`,
    );
    await queryRunner.createIndex(
      'sync_jobs',
      new TableIndex({ name: 'idx_sync_jobs_store_created', columnNames: ['store_id', 'created_at'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('sync_jobs', true);
  }
}
