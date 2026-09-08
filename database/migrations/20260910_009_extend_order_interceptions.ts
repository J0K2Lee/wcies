import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Sprint 4: interception workflow extensions (task §29/§32-§45).
 *
 * Sprint 3 only created interceptions; the full workflow now records the
 * scanned SKU/SN/target bin, the assignee's display name, the failure reason,
 * and an append-only status history so "when did it move from X to Y" is
 * always answerable (task §41).
 */
export class ExtendOrderInterceptions1789088400009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE order_interceptions ADD COLUMN assigned_to_name VARCHAR(100) NULL`);
    await queryRunner.query(`ALTER TABLE order_interceptions ADD COLUMN target_bin_id UUID NULL`);
    await queryRunner.query(`ALTER TABLE order_interceptions ADD COLUMN scanned_sku_id UUID NULL`);
    await queryRunner.query(`ALTER TABLE order_interceptions ADD COLUMN scanned_serial_numbers JSONB NULL`);
    await queryRunner.query(`ALTER TABLE order_interceptions ADD COLUMN scanned_at TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE order_interceptions ADD COLUMN failed_at TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE order_interceptions ADD COLUMN failed_reason TEXT NULL`);

    await queryRunner.createIndex(
      'order_interceptions',
      new TableIndex({ name: 'idx_order_interceptions_warehouse', columnNames: ['warehouse_id'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'order_interception_histories',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'interception_id', type: 'uuid', isNullable: false },
          { name: 'from_status', type: 'varchar', length: 30, isNullable: true },
          { name: 'to_status', type: 'varchar', length: 30, isNullable: false },
          { name: 'action', type: 'varchar', length: 40, isNullable: false },
          { name: 'operator_id', type: 'uuid', isNullable: true },
          { name: 'operator_name', type: 'varchar', length: 100, isNullable: false, default: `'system'` },
          { name: 'details', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        indices: [
          new TableIndex({ name: 'idx_order_interception_histories_interception', columnNames: ['interception_id'] }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_order_interception_histories_to_status',
            expression:
              "to_status IN ('CREATED', 'ASSIGNED', 'LOCATING', 'INTERCEPTED', 'FAILED', 'RETURNED_TO_STOCK', 'CLOSED')",
          }),
        ],
        foreignKeys: [
          {
            name: 'fk_order_interception_histories_interception',
            columnNames: ['interception_id'],
            referencedTableName: 'order_interceptions',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('order_interception_histories');
    await queryRunner.query(`DROP INDEX IF EXISTS idx_order_interceptions_warehouse`);
    await queryRunner.query(`ALTER TABLE order_interceptions DROP COLUMN IF EXISTS failed_reason`);
    await queryRunner.query(`ALTER TABLE order_interceptions DROP COLUMN IF EXISTS failed_at`);
    await queryRunner.query(`ALTER TABLE order_interceptions DROP COLUMN IF EXISTS scanned_at`);
    await queryRunner.query(`ALTER TABLE order_interceptions DROP COLUMN IF EXISTS scanned_serial_numbers`);
    await queryRunner.query(`ALTER TABLE order_interceptions DROP COLUMN IF EXISTS scanned_sku_id`);
    await queryRunner.query(`ALTER TABLE order_interceptions DROP COLUMN IF EXISTS target_bin_id`);
    await queryRunner.query(`ALTER TABLE order_interceptions DROP COLUMN IF EXISTS assigned_to_name`);
  }
}
