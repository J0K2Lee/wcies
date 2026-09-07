import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/** Sprint 1 S1-02: brands + simple category tree (task §13/§14). */
export class CreateBrandsCategories1789000800005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'brands',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'code', type: 'varchar', length: 100, isNullable: false },
          { name: 'name_zh', type: 'varchar', length: 200, isNullable: false },
          { name: 'name_en', type: 'varchar', length: 200, isNullable: true },
          { name: 'name_ru', type: 'varchar', length: 200, isNullable: true },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [{ name: 'uq_brands_code', columnNames: ['code'] }],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'categories',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'parent_id', type: 'uuid', isNullable: true },
          { name: 'code', type: 'varchar', length: 100, isNullable: false },
          { name: 'name_zh', type: 'varchar', length: 200, isNullable: false },
          { name: 'name_ru', type: 'varchar', length: 200, isNullable: true },
          { name: 'sort_order', type: 'integer', isNullable: false, default: '0' },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [{ name: 'uq_categories_code', columnNames: ['code'] }],
        foreignKeys: [
          new TableForeignKey({
            name: 'fk_categories_parent',
            columnNames: ['parent_id'],
            referencedTableName: 'categories',
            referencedColumnNames: ['id'],
          }),
        ],
      }),
    );
    await queryRunner.createIndex(
      'categories',
      new TableIndex({ name: 'idx_categories_parent', columnNames: ['parent_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('categories');
    await queryRunner.dropTable('brands');
  }
}
