import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sprint 10 T2: finance facts (docs/business-rules/finance.md, frozen
 * 2026-09-17).
 *
 * Four tables:
 * - finance_transactions: append-only money ledger (FV%06d vouchers,
 *   reversal pairs via reversed_by_voucher_no, never UPDATE/DELETE);
 * - finance_payouts: platform payout batches (DRAFT -> CONFIRMED/CANCELLED;
 *   confirming mints the linked SALE_INCOME transaction inside finance);
 * - order_settlements(+items): per-order revenue/cost/profit snapshot,
 *   UNIQUE(order_id), cost frozen at generation time;
 * - business code scopes finance_voucher / finance_payout seeded.
 *
 * Amounts are NUMERIC(18,4) per AGENTS.md §58; a payout's auto-transaction
 * is guarded by a partial unique index on payout_id (finance.md §4.2).
 */
export class CreateFinance1791600002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE finance_transactions (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        voucher_no            varchar(50) NOT NULL UNIQUE,
        direction             varchar(10) NOT NULL,
        category              varchar(30) NOT NULL,
        amount                numeric(18,4) NOT NULL,
        currency              varchar(10) NOT NULL DEFAULT 'CNY',
        occurred_at           timestamptz NOT NULL,
        store_id              uuid NULL REFERENCES stores(id),
        supplier_id           uuid NULL REFERENCES suppliers(id),
        order_id              uuid NULL REFERENCES orders(id),
        purchase_order_id     uuid NULL REFERENCES purchase_orders(id),
        payout_id             uuid NULL,
        reversed_by_voucher_no varchar(50) NULL,
        remark                text NULL,
        created_by            uuid NULL,
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_finance_transactions_amount_positive CHECK (amount > 0),
        CONSTRAINT ck_finance_transactions_direction CHECK (direction IN ('INCOME', 'EXPENSE')),
        CONSTRAINT ck_finance_transactions_category CHECK (category IN (
          'SALE_INCOME', 'SALE_REFUND', 'PURCHASE_PAYMENT', 'SUPPLIER_REFUND',
          'PLATFORM_FEE', 'LOGISTICS_FEE', 'OTHER_INCOME', 'OTHER_EXPENSE'))
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_finance_transactions_occurred ON finance_transactions (occurred_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_finance_transactions_category ON finance_transactions (category)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_finance_transactions_order ON finance_transactions (order_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_finance_transactions_po ON finance_transactions (purchase_order_id)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_finance_transactions_payout
         ON finance_transactions (payout_id) WHERE payout_id IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE finance_payouts (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        payout_no     varchar(50) NOT NULL UNIQUE,
        store_id      uuid NOT NULL REFERENCES stores(id),
        period_start  timestamptz NOT NULL,
        period_end    timestamptz NOT NULL,
        amount        numeric(18,4) NOT NULL,
        currency      varchar(10) NOT NULL DEFAULT 'CNY',
        status        varchar(20) NOT NULL DEFAULT 'DRAFT',
        remark        text NULL,
        created_by    uuid NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_finance_payouts_amount_positive CHECK (amount > 0),
        CONSTRAINT ck_finance_payouts_period CHECK (period_start <= period_end),
        CONSTRAINT ck_finance_payouts_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED'))
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_finance_payouts_store_period ON finance_payouts (store_id, period_start DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE order_settlements (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id            uuid NOT NULL UNIQUE REFERENCES orders(id),
        currency            varchar(10) NULL,
        revenue_total       numeric(18,4) NOT NULL DEFAULT 0,
        product_cost_total  numeric(18,4) NOT NULL DEFAULT 0,
        shipping_fee        numeric(18,4) NOT NULL DEFAULT 0,
        other_fee           numeric(18,4) NOT NULL DEFAULT 0,
        profit              numeric(18,4) NULL,
        has_missing_price   boolean NOT NULL DEFAULT false,
        has_missing_cost    boolean NOT NULL DEFAULT false,
        generated_by        uuid NULL,
        generated_at        timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_order_settlements_generated ON order_settlements (generated_at DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE order_settlement_items (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        settlement_id   uuid NOT NULL REFERENCES order_settlements(id) ON DELETE CASCADE,
        order_item_id   uuid NOT NULL REFERENCES order_items(id),
        sku_id          uuid NULL REFERENCES skus(id),
        quantity        numeric(18,3) NOT NULL,
        unit_price      numeric(18,4) NULL,
        revenue         numeric(18,4) NOT NULL DEFAULT 0,
        unit_cost       numeric(18,4) NULL,
        cost            numeric(18,4) NOT NULL DEFAULT 0,
        CONSTRAINT ck_order_settlement_items_quantity_positive CHECK (quantity > 0),
        CONSTRAINT uq_order_settlement_items_line UNIQUE (settlement_id, order_item_id)
      )`);
    await queryRunner.query(
      `CREATE INDEX idx_order_settlement_items_sku ON order_settlement_items (sku_id)`,
    );

    await queryRunner.query(`
      INSERT INTO business_code_sequences (scope_key, next_value, updated_at)
      VALUES ('finance_voucher', 1, now()), ('finance_payout', 1, now())
      ON CONFLICT (scope_key) DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS order_settlement_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS order_settlements`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_payouts`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_finance_transactions_payout`);
    await queryRunner.query(`DROP TABLE IF EXISTS finance_transactions`);
    await queryRunner.query(
      `DELETE FROM business_code_sequences WHERE scope_key IN ('finance_voucher', 'finance_payout')`,
    );
  }
}
