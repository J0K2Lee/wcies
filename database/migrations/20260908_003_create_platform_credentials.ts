import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 1 S1-01: encrypted platform credentials, strictly separated from
 * stores (task §11). One credential per (store_id, credential_type).
 */
export class CreatePlatformCredentials1789000800003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'platform_credentials',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'store_id', type: 'uuid', isNullable: false },
          { name: 'credential_type', type: 'varchar', length: 50, isNullable: false },
          { name: 'encrypted_payload', type: 'text', isNullable: false },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({
            name: 'uq_platform_credentials_store_type',
            columnNames: ['store_id', 'credential_type'],
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'fk_platform_credentials_store',
            columnNames: ['store_id'],
            referencedTableName: 'stores',
            referencedColumnNames: ['id'],
          }),
        ],
      }),
    );
    await queryRunner.createIndex(
      'platform_credentials',
      new TableIndex({ name: 'idx_platform_credentials_store', columnNames: ['store_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('platform_credentials');
  }
}
