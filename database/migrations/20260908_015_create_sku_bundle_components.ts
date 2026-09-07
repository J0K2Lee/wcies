import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/** Sprint 1: reserved bundle structure (task §55/§56); no UI in this sprint. */
export class CreateSkuBundleComponents1789000800015 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'sku_bundle_components',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'bundle_sku_id', type: 'uuid', isNullable: false },
          { name: 'component_sku_id', type: 'uuid', isNullable: false },
          { name: 'quantity', type: 'integer', isNullable: false },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          { name: 'uq_bundle_component', columnNames: ['bundle_sku_id', 'component_sku_id'] },
        ],
        foreignKeys: [
          {
            name: 'fk_bundle_bundle_sku',
            columnNames: ['bundle_sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_bundle_component_sku',
            columnNames: ['component_sku_id'],
            referencedTableName: 'skus',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'sku_bundle_components',
      new TableIndex({ name: 'idx_bundle_bundle_sku', columnNames: ['bundle_sku_id'] }),
    );
    await queryRunner.createIndex(
      'sku_bundle_components',
      new TableIndex({ name: 'idx_bundle_component_sku', columnNames: ['component_sku_id'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('sku_bundle_components');
  }
}
