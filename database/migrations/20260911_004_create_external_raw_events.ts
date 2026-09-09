import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Sprint 5 task §26/§27: external raw events (webhook audit + idempotency).
 *
 * Every incoming webhook payload is persisted BEFORE processing; the unique
 * (store_id, payload_hash) index deduplicates redeliveries when the platform
 * provides no event id (OZON does not - verified, see
 * docs/integrations/ozon.md).
 */
export class CreateExternalRawEvents1790000004000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'external_raw_events',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'gen_random_uuid()' },
          { name: 'platform', type: 'varchar', length: 30, isNullable: false },
          { name: 'store_id', type: 'uuid', isNullable: false },
          { name: 'event_type', type: 'varchar', length: 60, isNullable: false },
          { name: 'external_event_id', type: 'varchar', length: 255, isNullable: true },
          { name: 'payload', type: 'jsonb', isNullable: false },
          { name: 'payload_hash', type: 'varchar', length: 64, isNullable: false },
          { name: 'status', type: 'varchar', length: 20, isNullable: false, default: "'PENDING'" },
          { name: 'received_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'processed_at', type: 'timestamptz', isNullable: true },
          { name: 'error_code', type: 'varchar', length: 60, isNullable: true },
          { name: 'error_message', type: 'text', isNullable: true },
        ],
        foreignKeys: [
          {
            name: 'fk_external_raw_events_store',
            columnNames: ['store_id'],
            referencedTableName: 'stores',
            referencedColumnNames: ['id'],
          },
        ],
        checks: [
          {
            name: 'ck_external_raw_events_status',
            expression: `status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED', 'REJECTED')`,
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'external_raw_events',
      new TableIndex({
        name: 'uq_external_raw_events_store_payload',
        columnNames: ['store_id', 'payload_hash'],
        unique: true,
      }),
    );
    // Event-id dedup applies only when the platform supplies one.
    await queryRunner.createIndex(
      'external_raw_events',
      new TableIndex({
        name: 'uq_external_raw_events_store_event_id',
        columnNames: ['store_id', 'external_event_id'],
        unique: true,
        where: `external_event_id IS NOT NULL`,
      }),
    );
    await queryRunner.createIndex(
      'external_raw_events',
      new TableIndex({ name: 'idx_external_raw_events_received', columnNames: ['received_at'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('external_raw_events', true);
  }
}
