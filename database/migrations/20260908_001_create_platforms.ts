import { MigrationInterface, QueryRunner, Table, TableUnique } from 'typeorm';

/**
 * Sprint 1 S1-01: platforms master data + seed rows (task §6).
 * OZON / WB / YANDEX are inserted by the migration itself so a fresh database
 * is usable without manual SQL.
 */
export class CreatePlatforms1789000800001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'platforms',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'code', type: 'varchar', length: 30, isNullable: false },
          { name: 'name', type: 'varchar', length: 100, isNullable: false },
          { name: 'status', type: 'varchar', length: 30, isNullable: false, default: `'ACTIVE'` },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [new TableUnique({ name: 'uq_platforms_code', columnNames: ['code'] })],
      }),
    );

    await queryRunner.query(
      `INSERT INTO platforms (code, name, status) VALUES
        ('OZON', 'OZON', 'ACTIVE'),
        ('WB', 'Wildberries', 'ACTIVE'),
        ('YANDEX', 'Yandex Market', 'ACTIVE')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('platforms');
  }
}
