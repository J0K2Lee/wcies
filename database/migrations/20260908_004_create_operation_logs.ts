import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/** Sprint 1: append-only audit trail for master-data writes (task §62). */
export class CreateOperationLogs1789000800004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'operation_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'entity_type', type: 'varchar', length: 50, isNullable: false },
          { name: 'entity_id', type: 'uuid', isNullable: false },
          { name: 'entity_code', type: 'varchar', length: 255, isNullable: true },
          { name: 'action', type: 'varchar', length: 50, isNullable: false },
          { name: 'operator_id', type: 'uuid', isNullable: true },
          { name: 'operator_name', type: 'varchar', length: 100, isNullable: false },
          { name: 'changes', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
      }),
    );
    await queryRunner.createIndex(
      'operation_logs',
      new TableIndex({ name: 'idx_operation_logs_entity', columnNames: ['entity_type', 'entity_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('operation_logs');
  }
}
