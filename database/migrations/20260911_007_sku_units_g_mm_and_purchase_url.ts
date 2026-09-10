import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SKU unit convention change + purchase link (user-approved, 2026-09-09):
 *
 * - weight: kg (numeric(12,4)) -> g (numeric(12,3)); stored values x1000.
 * - dimensions: cm (numeric(12,3)) -> mm (integer); stored values x10.
 * - volume: cm3 -> mm3 (bigint, = l_mm x w_mm x h_mm, backend-computed);
 *   stored values x1000 keep physical volume identical.
 * - new purchase_url (<=1000 chars): seller's procurement link (1688/taobao).
 *
 * Dev-stage data conversion happens in-migration so existing rows keep their
 * physical meaning (e.g. 0.95 kg -> 950 g, 35.5 cm -> 355 mm).
 */
export class SkuUnitsGmmAndPurchaseUrl1790000007000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE skus RENAME COLUMN weight_kg TO weight_g`);
    await queryRunner.query(
      `ALTER TABLE skus ALTER COLUMN weight_g TYPE numeric(12,3) USING weight_g * 1000`,
    );

    await queryRunner.query(
      `ALTER TABLE skus ALTER COLUMN length_cm TYPE integer USING ROUND(length_cm * 10)::integer`,
    );
    await queryRunner.query(`ALTER TABLE skus RENAME COLUMN length_cm TO length_mm`);
    await queryRunner.query(
      `ALTER TABLE skus ALTER COLUMN width_cm TYPE integer USING ROUND(width_cm * 10)::integer`,
    );
    await queryRunner.query(`ALTER TABLE skus RENAME COLUMN width_cm TO width_mm`);
    await queryRunner.query(
      `ALTER TABLE skus ALTER COLUMN height_cm TYPE integer USING ROUND(height_cm * 10)::integer`,
    );
    await queryRunner.query(`ALTER TABLE skus RENAME COLUMN height_cm TO height_mm`);

    await queryRunner.query(`ALTER TABLE skus RENAME COLUMN volume_cm3 TO volume_mm3`);
    await queryRunner.query(
      `ALTER TABLE skus ALTER COLUMN volume_mm3 TYPE bigint USING ROUND(volume_mm3 * 1000)::bigint`,
    );

    await queryRunner.query(`ALTER TABLE skus ADD COLUMN purchase_url VARCHAR(1000) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE skus DROP COLUMN purchase_url`);

    await queryRunner.query(
      `ALTER TABLE skus ALTER COLUMN volume_mm3 TYPE numeric(18,3) USING volume_mm3 / 1000.0`,
    );
    await queryRunner.query(`ALTER TABLE skus RENAME COLUMN volume_mm3 TO volume_cm3`);

    await queryRunner.query(`ALTER TABLE skus RENAME COLUMN height_mm TO height_cm`);
    await queryRunner.query(
      `ALTER TABLE skus ALTER COLUMN height_cm TYPE numeric(12,3) USING height_cm / 10.0`,
    );
    await queryRunner.query(`ALTER TABLE skus RENAME COLUMN width_mm TO width_cm`);
    await queryRunner.query(
      `ALTER TABLE skus ALTER COLUMN width_cm TYPE numeric(12,3) USING width_cm / 10.0`,
    );
    await queryRunner.query(`ALTER TABLE skus RENAME COLUMN length_mm TO length_cm`);
    await queryRunner.query(
      `ALTER TABLE skus ALTER COLUMN length_cm TYPE numeric(12,3) USING length_cm / 10.0`,
    );

    await queryRunner.query(
      `ALTER TABLE skus ALTER COLUMN weight_g TYPE numeric(12,4) USING weight_g / 1000.0`,
    );
    await queryRunner.query(`ALTER TABLE skus RENAME COLUMN weight_g TO weight_kg`);
  }
}
