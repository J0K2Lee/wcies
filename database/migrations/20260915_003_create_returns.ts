import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dual-axis task T5 (2026-09-15): return/refund module tables
 * (docs/business-rules/returns.md).
 *
 * - platform_returns: read-only platform return facts, unique per
 *   (store_id, platform_return_id), best-effort order linkage;
 * - return_batches / return_batch_items: the physical work documents;
 *   inspection (condition) is the only stock write-back path;
 * - the partial unique index on return_batch_items.platform_return_id is
 *   created with RAW SQL: TypeORM TableIndex({unique, where}) silently
 *   drops the UNIQUE on partial indexes (known pitfall, ozon.md §9.1).
 */
export class CreateReturns1791500003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE platform_returns (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id             uuid NOT NULL,
        platform_return_id   varchar(100) NOT NULL,
        platform_order_id    varchar(255) NULL,
        order_id             uuid NULL,
        state                varchar(100) NULL,
        refund_state         varchar(100) NULL,
        platform_sku_id      varchar(255) NULL,
        offer_id             varchar(255) NULL,
        quantity             varchar(20) NOT NULL,
        platform_created_at  timestamptz NULL,
        raw_data             jsonb NULL,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_platform_returns_store_return UNIQUE (store_id, platform_return_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_platform_returns_order ON platform_returns (order_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_platform_returns_store_state ON platform_returns (store_id, state)`,
    );

    await queryRunner.query(`
      CREATE TABLE return_batches (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_no     varchar(50) NOT NULL UNIQUE,
        warehouse_id uuid NOT NULL,
        status       varchar(30) NOT NULL,
        source_note  varchar(500) NULL,
        remark       text NULL,
        created_by   uuid NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_return_batches_status ON return_batches (status)`);
    await queryRunner.query(
      `CREATE INDEX idx_return_batches_warehouse ON return_batches (warehouse_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE return_batch_items (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id            uuid NOT NULL REFERENCES return_batches (id),
        platform_return_id  uuid NULL REFERENCES platform_returns (id),
        sku_id              uuid NOT NULL,
        quantity            numeric(18,3) NOT NULL,
        condition           varchar(20) NOT NULL DEFAULT 'PENDING',
        bin_id              uuid NULL,
        remark              text NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_return_items_condition
          CHECK (condition IN ('PENDING', 'SELLABLE', 'DEFECTIVE', 'LOST')),
        CONSTRAINT ck_return_items_quantity_positive CHECK (quantity > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_return_batch_items_batch ON return_batch_items (batch_id)`,
    );
    // Partial UNIQUE in raw SQL (TypeORM pitfall, see class doc).
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_return_batch_items_platform_return
        ON return_batch_items (platform_return_id)
        WHERE platform_return_id IS NOT NULL
    `);

    // Register the RT%06d business-code scope seed (lazy in the service, but
    // seeding keeps the sequence table self-documenting).
    await queryRunner.query(`
      INSERT INTO business_code_sequences (scope_key, next_value, updated_at)
      VALUES ('return_batch', 1, now())
      ON CONFLICT (scope_key) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_return_batch_items_platform_return`);
    await queryRunner.query(`DROP TABLE IF EXISTS return_batch_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS return_batches`);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_returns`);
  }
}
