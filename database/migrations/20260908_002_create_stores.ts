import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/** Sprint 1 S1-01: stores, unique per (platform_id, store_code) - task §8. */
export class CreateStores1789000800002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'stores',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'platform_id', type: 'uuid', isNullable: false },
          { name: 'store_code', type: 'varchar', length: 100, isNullable: false },
          { name: 'name', type: 'varchar', length: 200, isNullable: false },
          { name: 'seller_id', type: 'varchar', length: 255, isNullable: true },
          { name: 'default_currency', type: 'varchar', length: 10, isNullable: true },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'settings', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({ name: 'uq_stores_platform_code', columnNames: ['platform_id', 'store_code'] }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'fk_stores_platform',
            columnNames: ['platform_id'],
            referencedTableName: 'platforms',
            referencedColumnNames: ['id'],
          }),
        ],
      }),
    );
    await queryRunner.createIndex(
      'stores',
      new TableIndex({ name: 'idx_stores_platform', columnNames: ['platform_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('stores');
  }
}
