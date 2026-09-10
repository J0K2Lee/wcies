import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three-level category semantics (Sprint 6, decision 0005):
 *
 * - level column (1..3) backfilled recursively from the existing tree, then
 *   enforced by CHECKs so no code path can bypass the depth limit;
 * - (level = 1) <=> (parent_id IS NULL): roots are exactly level 1;
 * - unique (parent_id, lower(name_zh)) NULLS NOT DISTINCT: same-name siblings
 *   under one parent are rejected INCLUDING between roots (default PG
 *   semantics treat NULLs as distinct, which would let duplicate root names
 *   through - NULLS NOT DISTINCT closes that hole).
 *
 * Pre-existing same-parent duplicate names make the index creation fail
 * loudly (ambiguous data must error, never be silently fixed - task §89).
 */
export class AddCategoryLevelAndNameUniqueness1790000009000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories ADD COLUMN level smallint`);

    await queryRunner.query(`
      WITH RECURSIVE d AS (
        SELECT id, 1 AS lvl FROM categories WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, d.lvl + 1 FROM categories c JOIN d ON c.parent_id = d.id
      )
      UPDATE categories c SET level = d.lvl FROM d WHERE d.id = c.id
    `);

    await queryRunner.query(`ALTER TABLE categories ALTER COLUMN level SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE categories ADD CONSTRAINT ck_categories_level CHECK (level BETWEEN 1 AND 3)`,
    );
    await queryRunner.query(
      `ALTER TABLE categories ADD CONSTRAINT ck_categories_root CHECK ((level = 1) = (parent_id IS NULL))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_categories_parent_name
         ON categories (parent_id, lower(name_zh)) NULLS NOT DISTINCT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_categories_parent_name`);
    await queryRunner.query(`ALTER TABLE categories DROP CONSTRAINT IF EXISTS ck_categories_root`);
    await queryRunner.query(`ALTER TABLE categories DROP CONSTRAINT IF EXISTS ck_categories_level`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN IF EXISTS level`);
  }
}
