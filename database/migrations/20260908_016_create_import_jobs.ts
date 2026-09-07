import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/** Sprint 1 S1-13: import job bookkeeping (task §57-§61). */
export class CreateImportJobs1789000800016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'import_jobs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'import_type', type: 'varchar', length: 50, isNullable: false },
          { name: 'status', type: 'varchar', length: 30, isNullable: false },
          { name: 'object_key', type: 'text', isNullable: false },
          { name: 'original_filename', type: 'varchar', length: 255, isNullable: false },
          { name: 'total_rows', type: 'integer', isNullable: false, default: '0' },
          { name: 'valid_rows', type: 'integer', isNullable: false, default: '0' },
          { name: 'invalid_rows', type: 'integer', isNullable: false, default: '0' },
          { name: 'imported_rows', type: 'integer', isNullable: false, default: '0' },
          { name: 'failed_rows', type: 'integer', isNullable: false, default: '0' },
          { name: 'errors', type: 'jsonb', isNullable: true },
          { name: 'rows_data', type: 'jsonb', isNullable: true },
          { name: 'created_by', type: 'uuid', isNullable: true },
          { name: 'created_by_name', type: 'varchar', length: 100, isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'imported_at', type: 'timestamptz', isNullable: true },
        ],
        foreignKeys: [
          {
            name: 'fk_import_jobs_created_by',
            columnNames: ['created_by'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'import_jobs',
      new TableIndex({ name: 'idx_import_jobs_type_status', columnNames: ['import_type', 'status'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('import_jobs');
  }
}
