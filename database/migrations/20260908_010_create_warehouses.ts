import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/** Sprint 1 S1-07: warehouses (task §35/§36). No VIRTUAL type, no groups. */
export class CreateWarehouses1789000800010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'warehouses',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'warehouse_code', type: 'varchar', length: 100, isNullable: false },
          { name: 'name', type: 'varchar', length: 200, isNullable: false },
          { name: 'warehouse_type', type: 'varchar', length: 30, isNullable: false },
          { name: 'country_code', type: 'varchar', length: 10, isNullable: true },
          { name: 'province', type: 'varchar', length: 100, isNullable: true },
          { name: 'city', type: 'varchar', length: 100, isNullable: true },
          { name: 'address', type: 'text', isNullable: true },
          { name: 'contact_name', type: 'varchar', length: 100, isNullable: true },
          { name: 'contact_phone', type: 'varchar', length: 100, isNullable: true },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'remark', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [{ name: 'uq_warehouses_code', columnNames: ['warehouse_code'] }],
      }),
    );
    await queryRunner.createIndex(
      'warehouses',
      new TableIndex({ name: 'idx_warehouses_type', columnNames: ['warehouse_type'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('warehouses');
  }
}
