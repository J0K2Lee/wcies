import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brand naming semantics (Sprint 6, decision 0006):
 *
 * - old name_zh (NOT NULL, was the de-facto display name) becomes `name`:
 *   the general name, required, the default display field;
 * - a NEW nullable name_zh is added and backfilled from `name`: the legacy
 *   values were semantically Chinese names, so they seed both slots;
 * - name_en / name_ru stay as optional complements.
 */
export class RenameBrandNameZhToName1790000010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE brands RENAME COLUMN name_zh TO name`);
    await queryRunner.query(`ALTER TABLE brands ADD COLUMN name_zh varchar(200) NULL`);
    await queryRunner.query(`UPDATE brands SET name_zh = name WHERE name_zh IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE brands DROP COLUMN name_zh`);
    await queryRunner.query(`ALTER TABLE brands RENAME COLUMN name TO name_zh`);
  }
}
