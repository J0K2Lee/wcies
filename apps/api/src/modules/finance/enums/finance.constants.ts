/**
 * Sprint 10 finance typed constants (AGENTS.md §64; finance.md, frozen
 * 2026-09-17). Adding a value here is a business-rule change and must be
 * reflected in docs/business-rules/finance.md first.
 */

export const FINANCE_DIRECTIONS = ['INCOME', 'EXPENSE'] as const;
export type FinanceDirection = (typeof FINANCE_DIRECTIONS)[number];

export const FINANCE_TRANSACTION_CATEGORIES = [
  'SALE_INCOME',
  'SALE_REFUND',
  'PURCHASE_PAYMENT',
  'SUPPLIER_REFUND',
  'PLATFORM_FEE',
  'LOGISTICS_FEE',
  'OTHER_INCOME',
  'OTHER_EXPENSE',
] as const;
export type FinanceTransactionCategory = (typeof FINANCE_TRANSACTION_CATEGORIES)[number];

/**
 * Legal direction per category (finance.md §3.2). A voucher whose direction
 * mismatches its category is rejected at the door.
 */
export const FINANCE_CATEGORY_DIRECTIONS: Readonly<
  Record<FinanceTransactionCategory, FinanceDirection>
> = {
  SALE_INCOME: 'INCOME',
  SUPPLIER_REFUND: 'INCOME',
  OTHER_INCOME: 'INCOME',
  SALE_REFUND: 'EXPENSE',
  PURCHASE_PAYMENT: 'EXPENSE',
  PLATFORM_FEE: 'EXPENSE',
  LOGISTICS_FEE: 'EXPENSE',
  OTHER_EXPENSE: 'EXPENSE',
};

/** Payout lifecycle (finance.md §4.2). */
export const FINANCE_PAYOUT_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;
export type FinancePayoutStatus = (typeof FINANCE_PAYOUT_STATUSES)[number];

/** Derived purchase payment state (finance.md §6) - computed, never stored. */
export const PURCHASE_PAYMENT_STATES = [
  'NOTHING_TO_PAY',
  'UNPAID',
  'PARTIAL',
  'PAID',
  'OVERPAID',
] as const;
export type PurchasePaymentState = (typeof PURCHASE_PAYMENT_STATES)[number];

/** The only currency WCIES costs are booked in (SKU cost_currency default). */
export const COST_CURRENCY = 'CNY';
