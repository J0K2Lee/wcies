import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Sprint 9 (planning T1, decision 5 = option B): platform status transitions
 * get their OWN table, physically separate from the ERP state machine's
 * order_status_history. The two timelines have different vocabularies,
 * writers and participants (platform raw strings vs ERP states); the order
 * detail view merges them by created_at (measured join cost ~0.1ms).
 *
 * Rows are written ONLY when a sync observes an actual platform_status
 * change (idempotent re-syncs write nothing). from_status is nullable to
 * cover historical rows whose platform_status was NULL before the first
 * observed transition.
 */
export class CreatePlatformStatusHistory1790000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'platform_status_history',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'order_id', type: 'uuid', isNullable: false },
          {
            // NULL = the order's platform_status was NULL before this
            // transition (historical rows, see planning §1.3 point 4).
            name: 'from_status',
            type: 'varchar',
            length: 64,
            isNullable: true,
          },
          { name: 'to_status', type: 'varchar', length: 64, isNullable: false },
          {
            // Which channel delivered the fact: ORDER_SYNC / WEBHOOK / ...
            name: 'source',
            type: 'varchar',
            length: 30,
            isNullable: true,
          },
          { name: 'operator_name', type: 'varchar', length: 100, isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        foreignKeys: [
          {
            name: 'fk_platform_status_history_order',
            columnNames: ['order_id'],
            referencedTableName: 'orders',
            referencedColumnNames: ['id'],
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'platform_status_history',
      new TableIndex({
        name: 'idx_platform_status_history_order',
        columnNames: ['order_id', 'created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('platform_status_history', true);
  }
}
