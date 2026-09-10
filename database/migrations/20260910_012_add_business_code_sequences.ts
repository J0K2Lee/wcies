import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Centralized business code sequences (Sprint 6, decision 0001/0002):
 *
 * - business_code_sequences: scope_key + next_value, the single source of
 *   scoped numbering (warehouse:{TYPE} / store:{PLATFORM} / brand / category
 *   / product / sku:{productId}).
 * - products.code_seq: integer fact source for the product sequence so the
 *   derived SKU code (SKU%06d%03d) never re-parses product_code strings.
 *   Backfill: parse digits out of product_code; unparseable rows get
 *   consecutive numbers after the max parsed value (ordered by created_at) —
 *   NOT bare ROW_NUMBER, which could collide with parsed values.
 * - The 'product' scope is seeded with GREATEST(old seq_product_code last
 *   used, max backfilled code_seq) so new PN%06d codes never reuse numbers.
 * - platforms.name normalized for display: Ozon / Wildberries / Yandex.
 */
export class AddBusinessCodeSequences1790000008000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE business_code_sequences (
        scope_key   varchar(120) PRIMARY KEY,
        next_value  bigint       NOT NULL,
        updated_at  timestamptz  NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`ALTER TABLE products ADD COLUMN code_seq integer`);

    // Recover the sequence number only from system-generated codes
    // (PRD%06d historically, PN%06d from now on) - an injective parse that
    // can never collide. Ad-hoc/manual codes (which may concatenate several
    // digit groups or overflow int4) fall through to the sequential
    // assignment below instead of failing the cast.
    await queryRunner.query(`
      UPDATE products
         SET code_seq = NULLIF(substring(product_code from '^(?:PRD|PN)([0-9]{1,9})$'), '')::integer
    `);

    // Rows without any digit in product_code: consecutive numbers after the
    // max parsed value, ordered by created_at (id as deterministic tiebreak).
    await queryRunner.query(`
      WITH unparsed AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
          FROM products
         WHERE code_seq IS NULL
      ), bounds AS (
        SELECT COALESCE(MAX(code_seq), 0) AS max_seq
          FROM products
         WHERE code_seq IS NOT NULL
      )
      UPDATE products p
         SET code_seq = bounds.max_seq + unparsed.rn
        FROM unparsed, bounds
       WHERE p.id = unparsed.id
    `);

    await queryRunner.query(`ALTER TABLE products ALTER COLUMN code_seq SET NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_products_code_seq ON products (code_seq)`);

    // Seed the product scope past every number the old sequence ever handed
    // out and past every backfilled value. next_value stores the last used
    // number; the first take bumps it to next_value + 1.
    await queryRunner.query(`
      INSERT INTO business_code_sequences (scope_key, next_value, updated_at)
      VALUES (
        'product',
        GREATEST(
          (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END
             FROM seq_product_code),
          COALESCE((SELECT MAX(code_seq) FROM products), 0)
        ),
        now()
      )
      ON CONFLICT (scope_key) DO NOTHING
    `);

    await queryRunner.query(`UPDATE platforms SET name = 'Ozon'        WHERE code = 'OZON'`);
    await queryRunner.query(`UPDATE platforms SET name = 'Wildberries' WHERE code = 'WB'`);
    await queryRunner.query(`UPDATE platforms SET name = 'Yandex'      WHERE code = 'YANDEX'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Original seed values (20260908_001_create_platforms.ts).
    await queryRunner.query(`UPDATE platforms SET name = 'OZON'          WHERE code = 'OZON'`);
    await queryRunner.query(`UPDATE platforms SET name = 'Wildberries'   WHERE code = 'WB'`);
    await queryRunner.query(`UPDATE platforms SET name = 'Yandex Market' WHERE code = 'YANDEX'`);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_products_code_seq`);
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS code_seq`);
    await queryRunner.query(`DROP TABLE IF EXISTS business_code_sequences`);
  }
}
