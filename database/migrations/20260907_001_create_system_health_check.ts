import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * Sprint 0 migration smoke test: an intentionally tiny system table that
 * proves the migration chain end-to-end (S0 spec §28).
 */
export class CreateSystemHealthCheck1788700800001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'system_health_check',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, isGenerated: true, generationStrategy: 'uuid' },
          { name: 'checked_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'note', type: 'varchar', length: 200, isNullable: true },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('system_health_check');
  }
}
