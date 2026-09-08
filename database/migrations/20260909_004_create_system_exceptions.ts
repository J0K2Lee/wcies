import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 3: minimal exception center (task §25-§27).
 *
 * One OPEN row per (exception_type, reference) - enforced by the partial
 * unique index so backorder retries can never create exception spam.
 * History is never physically deleted; closing means RESOLVED/IGNORED.
 */
export class CreateSystemExceptions1789002000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE system_exception_no_seq START 1`);
    await queryRunner.createTable(
      new Table({
        name: 'system_exceptions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'exception_no', type: 'varchar', length: 30, isNullable: false },
          { name: 'exception_type', type: 'varchar', length: 60, isNullable: false },
          { name: 'severity', type: 'varchar', length: 20, isNullable: false, default: `'HIGH'` },
          { name: 'status', type: 'varchar', length: 20, isNullable: false, default: `'OPEN'` },
          { name: 'reference_type', type: 'varchar', length: 40, isNullable: false },
          { name: 'reference_id', type: 'uuid', isNullable: false },
          { name: 'store_id', type: 'uuid', isNullable: true },
          { name: 'message', type: 'text', isNullable: false },
          { name: 'details', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'resolved_at', type: 'timestamptz', isNullable: true },
        ],
        uniques: [new TableUnique({ name: 'uq_system_exceptions_no', columnNames: ['exception_no'] })],
        indices: [
          new TableIndex({ name: 'idx_system_exceptions_status', columnNames: ['status'] }),
          new TableIndex({ name: 'idx_system_exceptions_reference', columnNames: ['reference_type', 'reference_id'] }),
          new TableIndex({ name: 'idx_system_exceptions_store', columnNames: ['store_id'] }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_system_exceptions_status',
            expression: "status IN ('OPEN', 'RESOLVED', 'IGNORED')",
          }),
        ],
        foreignKeys: [
          {
            name: 'fk_system_exceptions_store',
            columnNames: ['store_id'],
            referencedTableName: 'stores',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_system_exceptions_open ON system_exceptions (exception_type, reference_type, reference_id) WHERE status = 'OPEN'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('system_exceptions');
    await queryRunner.query(`DROP SEQUENCE IF EXISTS system_exception_no_seq`);
  }
}
