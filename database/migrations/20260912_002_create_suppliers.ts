import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 7 task §9 (T2): reusable supplier master data.
 *
 * Suppliers stay OPTIONAL on purchase documents (decision 0013 §3): one-off
 * online purchases use a free-text source_note instead, so this table only
 * holds genuinely reusable vendors. Zero-reference hard delete follows
 * decision 0003; usage is enforced in the service layer.
 */
export class CreateSuppliers1791000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE suppliers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(50) NOT NULL UNIQUE,
        name varchar(200) NOT NULL,
        contact_name varchar(100) NULL,
        contact_phone varchar(100) NULL,
        status varchar(30) NOT NULL DEFAULT 'ACTIVE',
        remark text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_suppliers_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_suppliers_name ON suppliers (name)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE suppliers`);
  }
}
