import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dual-axis task T1 (2026-09-15): normalized platform logistics stage on the
 * order header.
 *
 * - platform_stage: mapper-derived AWAITING_SHIPMENT / IN_TRANSIT / DELIVERED
 *   / CANCELLED (a platform FACT, never an ERP state, AGENTS.md §38);
 * - platform_stage_changed_at: the stall-clock anchor (docs §2.4) - the
 *   platform's OWN timestamp for entering the stage;
 * - platform_facts_checked_at: scheduling cursor of the T2 fallback re-read
 *   rotation ("last time we CONFIRMED this order's facts"), not a fact.
 *
 * Backfill is idempotent and CASE-limited to the verified vocabulary
 * (docs/integrations/ozon.md §平台阶段映射); unclassified platform_status
 * values keep NULL and are counted, never guessed (AGENTS.md §88/§89).
 */
export class AddOrderPlatformStage1791500001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE orders ADD COLUMN platform_stage varchar(30) NULL`);
    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN platform_stage_changed_at timestamptz NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN platform_facts_checked_at timestamptz NULL`,
    );

    // Stage backfill: only the verified OZON vocabulary. Everything else
    // (incl. NULL platform_status) stays NULL.
    await queryRunner.query(
      `UPDATE orders SET platform_stage = CASE platform_status
          WHEN 'awaiting_approve' THEN 'AWAITING_SHIPMENT'
          WHEN 'awaiting_packaging' THEN 'AWAITING_SHIPMENT'
          WHEN 'awaiting_registration' THEN 'AWAITING_SHIPMENT'
          WHEN 'awaiting_deliver' THEN 'AWAITING_SHIPMENT'
          WHEN 'delivering' THEN 'IN_TRANSIT'
          WHEN 'driver_pickup' THEN 'IN_TRANSIT'
          WHEN 'acceptance_in_progress' THEN 'IN_TRANSIT'
          WHEN 'delivered' THEN 'DELIVERED'
          WHEN 'cancelled' THEN 'CANCELLED'
          ELSE NULL
       END
       WHERE platform_stage IS NULL`,
    );

    // Anchor backfill, stage-scoped (docs §2.4): IN_TRANSIT anchors on
    // delivering_date, DELIVERED on fact_delivery_date (both tolerant - a
    // missing/invalid string falls through). Fallback chain: raw_data
    // timestamp -> the order's latest platform_status_history row -> created_at.
    await queryRunner.query(
      `UPDATE orders o SET platform_stage_changed_at = COALESCE(
          (SELECT NULLIF(regexp_replace(o.raw_data->>'delivering_date', '^\\s+$', ''), '')
             WHERE o.raw_data->>'delivering_date' ~ '^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}')::timestamptz,
          (SELECT h.created_at FROM platform_status_history h
             WHERE h.order_id = o.id ORDER BY h.created_at DESC LIMIT 1),
          o.created_at
       )
       WHERE o.platform_stage = 'IN_TRANSIT' AND o.platform_stage_changed_at IS NULL`,
    );
    await queryRunner.query(
      `UPDATE orders o SET platform_stage_changed_at = COALESCE(
          (SELECT NULLIF(regexp_replace(o.raw_data->>'fact_delivery_date', '^\\s+$', ''), '')
             WHERE o.raw_data->>'fact_delivery_date' ~ '^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}')::timestamptz,
          (SELECT h.created_at FROM platform_status_history h
             WHERE h.order_id = o.id ORDER BY h.created_at DESC LIMIT 1),
          o.created_at
       )
       WHERE o.platform_stage = 'DELIVERED' AND o.platform_stage_changed_at IS NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX idx_orders_store_stage ON orders (store_id, platform_stage)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_orders_erp_status_stage ON orders (erp_status, platform_stage)`,
    );

    // Audit trail for the backfill (AGENTS.md §89): how many rows keep an
    // unclassified/absent stage so nothing is silently dropped.
    const counts = (await queryRunner.query(
      `SELECT
          COUNT(*) FILTER (WHERE platform_stage IS NOT NULL) AS staged,
          COUNT(*) FILTER (WHERE platform_status IS NOT NULL AND platform_stage IS NULL) AS unclassified
       FROM orders`,
    )) as Array<{ staged: string; unclassified: string }>;
    const row = counts[0];
    // eslint-disable-next-line no-console
    console.log(
      `[migration add_order_platform_stage] staged=${row?.staged ?? 0} unclassified=${row?.unclassified ?? 0}`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_orders_erp_status_stage`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_orders_store_stage`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN platform_facts_checked_at`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN platform_stage_changed_at`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN platform_stage`);
  }
}
