import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 4: partial shipping support on reservation lines (task §22/§26).
 *
 * shipped_qty tracks how much of a line's PICKED quantity has physically left
 * stock; the line (and reservation header) only reaches CONSUMED when it
 * catches up with picked_qty. The CHECK is replaced to keep 0 <= shipped <=
 * picked.
 */
export class ExtendReservationLinesShipped1789088400008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE inventory_reservation_lines ADD COLUMN shipped_qty NUMERIC(18,3) NOT NULL DEFAULT 0`);
    await queryRunner.query(`UPDATE inventory_reservation_lines SET shipped_qty = 0`);
    await queryRunner.query(`ALTER TABLE inventory_reservation_lines DROP CONSTRAINT IF EXISTS ck_inventory_reservation_lines_qty`);
    await queryRunner.query(
      `ALTER TABLE inventory_reservation_lines ADD CONSTRAINT ck_inventory_reservation_lines_qty
         CHECK (quantity > 0 AND picked_qty >= 0 AND picked_qty <= quantity AND shipped_qty >= 0 AND shipped_qty <= picked_qty)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE inventory_reservation_lines DROP CONSTRAINT IF EXISTS ck_inventory_reservation_lines_qty`);
    await queryRunner.query(
      `ALTER TABLE inventory_reservation_lines ADD CONSTRAINT ck_inventory_reservation_lines_qty
         CHECK (quantity > 0 AND picked_qty >= 0 AND picked_qty <= quantity)`,
    );
    await queryRunner.query(`ALTER TABLE inventory_reservation_lines DROP COLUMN IF EXISTS shipped_qty`);
  }
}
