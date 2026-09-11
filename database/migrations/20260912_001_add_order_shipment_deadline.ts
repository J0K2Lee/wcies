import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 7 task §8 (T1): platform shipment deadline as a structured column.
 *
 * OZON's shipment_date (must ship before this time or a higher tariff
 * applies) already sits in orders.raw_data but is invisible to queries/UI.
 * This adds the structured companion column (raw_data stays the verbatim
 * fact, AGENTS.md §34) and backfills it from raw_data so the four real dev
 * orders become visible immediately - guarded cast, invalid strings stay
 * NULL instead of failing the migration.
 */
export class AddOrderShipmentDeadline1791000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE orders ADD COLUMN shipment_deadline timestamptz NULL`);
    // Best-effort backfill of pre-existing rows (dev data): ISO-8601 strings
    // only; anything else keeps NULL rather than aborting the migration.
    await queryRunner.query(
      `UPDATE orders
       SET shipment_deadline = (raw_data->>'shipment_date')::timestamptz
       WHERE shipment_deadline IS NULL
         AND raw_data ? 'shipment_date'
         AND (raw_data->>'shipment_date') ~ '^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN shipment_deadline`);
  }
}
