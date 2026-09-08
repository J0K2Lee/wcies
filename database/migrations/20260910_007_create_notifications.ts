import { MigrationInterface, QueryRunner, Table, TableCheck, TableIndex } from 'typeorm';

/**
 * Sprint 4: notifications (task §47-§51).
 *
 * Formal NotificationModule storage. SYSTEM notifications are created
 * already-SENT (in-app fact); FEISHU rows go PENDING -> queue -> SENT/FAILED.
 * Notification failure NEVER breaks the business transaction that published
 * the domain event (task §51).
 */
export class CreateNotifications1789088400007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'notifications',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'type', type: 'varchar', length: 60, isNullable: false },
          { name: 'channel', type: 'varchar', length: 20, isNullable: false },
          { name: 'reference_type', type: 'varchar', length: 40, isNullable: false },
          { name: 'reference_id', type: 'uuid', isNullable: false },
          { name: 'recipient', type: 'varchar', length: 255, isNullable: true },
          { name: 'title', type: 'varchar', length: 255, isNullable: false },
          { name: 'content', type: 'text', isNullable: false },
          { name: 'status', type: 'varchar', length: 20, isNullable: false, default: `'PENDING'` },
          { name: 'attempt_count', type: 'integer', isNullable: false, default: '0' },
          { name: 'last_error', type: 'text', isNullable: true },
          { name: 'sent_at', type: 'timestamptz', isNullable: true },
          { name: 'failed_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        indices: [
          new TableIndex({ name: 'idx_notifications_type', columnNames: ['type'] }),
          new TableIndex({ name: 'idx_notifications_channel_status', columnNames: ['channel', 'status'] }),
          new TableIndex({ name: 'idx_notifications_reference', columnNames: ['reference_type', 'reference_id'] }),
          new TableIndex({ name: 'idx_notifications_created_at', columnNames: ['created_at'] }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_notifications_status',
            expression: "status IN ('PENDING', 'SENT', 'FAILED', 'CANCELLED')",
          }),
          new TableCheck({
            name: 'ck_notifications_channel',
            expression: "channel IN ('SYSTEM', 'FEISHU')",
          }),
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('notifications');
  }
}
