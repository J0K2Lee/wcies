import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Decision 0019 (2026-10-09, user instruction): internal barcodes become
 * 6-digit pure numeric. Existing system-generated barcodes are CONVERTED -
 * this supersedes decision 0017's "old barcodes stay as-is" stance.
 *
 * - Only rows matching the system-generated patterns `WCSKU%08d` / `W%08d`
 *   are touched; manually entered INTERNAL barcodes are opaque strings and
 *   stay as-is (injective parse only, never a guess - AGENTS.md §89).
 * - All generations ever issued came from the SAME `seq_internal_barcode`,
 *   so numeric parts are globally unique and the conversion is injective.
 * - A collision with a pre-existing barcode value aborts the migration
 *   loudly via uq_sku_barcodes_barcode (ambiguous data must fail, not
 *   silently overwrite). The explicit pre-check below names the offenders.
 * - The sequence is untouched: the next issued number (e.g. 000006) can
 *   never collide with a converted value (same numeric space).
 */
export class InternalBarcode6Digits1793200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const collisions = await queryRunner.query<{ barcode: string }[]>(`
      SELECT new_barcode AS barcode FROM (
        SELECT lpad((regexp_replace(barcode, '^(WCSKU|W)', ''))::bigint::text, 6, '0') AS new_barcode
          FROM sku_barcodes
         WHERE barcode_type = 'INTERNAL' AND barcode ~ '^(WCSKU|W)[0-9]{8}$'
      ) conv
      WHERE EXISTS (
        SELECT 1 FROM sku_barcodes existing WHERE existing.barcode = conv.new_barcode
      )
    `);
    if (collisions !== null && collisions.length > 0) {
      throw new Error(
        `internal barcode conversion would collide with existing values: ${collisions.map((row) => row.barcode).join(', ')}`,
      );
    }

    await queryRunner.query(`
      UPDATE sku_barcodes
         SET barcode = lpad((regexp_replace(barcode, '^(WCSKU|W)', ''))::bigint::text, 6, '0')
       WHERE barcode_type = 'INTERNAL'
         AND barcode ~ '^(WCSKU|W)[0-9]{8}$'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort inverse: numeric INTERNAL values map back to `W%08d`.
    // Manual 6-digit numeric INTERNAL barcodes would also gain the W prefix -
    // acceptable for a dev-environment revert; distinguishable by nothing,
    // which is exactly why down() exists only as a safety hatch.
    await queryRunner.query(`
      UPDATE sku_barcodes
         SET barcode = 'W' || lpad(barcode, 8, '0')
       WHERE barcode_type = 'INTERNAL'
         AND barcode ~ '^[0-9]{6,8}$'
    `);
  }
}
