import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinanceDirection, FinanceTransactionCategory } from '../enums/finance.constants';

/**
 * Append-only money ledger row (finance.md §3). Vouchers are never UPDATED
 * or DELETEd - mistakes are reversed by a twin voucher with the opposite
 * direction (reversed_by_voucher_no points both ways).
 */
@Entity('finance_transactions')
@Index('uq_finance_transactions_voucher', ['voucherNo'], { unique: true })
@Index('idx_finance_transactions_occurred', ['occurredAt'])
@Index('idx_finance_transactions_category', ['category'])
@Index('idx_finance_transactions_order', ['orderId'])
@Index('idx_finance_transactions_po', ['purchaseOrderId'])
export class FinanceTransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, name: 'voucher_no' })
  voucherNo!: string;

  @Column({ type: 'varchar', length: 10, name: 'direction' })
  direction!: FinanceDirection;

  @Column({ type: 'varchar', length: 30, name: 'category' })
  category!: FinanceTransactionCategory;

  /** Always positive; the sign lives in `direction`. */
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  amount!: string;

  @Column({ type: 'varchar', length: 10, name: 'currency', default: 'CNY' })
  currency!: string;

  @Column({ type: 'timestamptz', name: 'occurred_at' })
  occurredAt!: Date;

  @Column({ type: 'uuid', name: 'store_id', nullable: true })
  storeId!: string | null;

  @Column({ type: 'uuid', name: 'supplier_id', nullable: true })
  supplierId!: string | null;

  @Column({ type: 'uuid', name: 'order_id', nullable: true })
  orderId!: string | null;

  @Column({ type: 'uuid', name: 'purchase_order_id', nullable: true })
  purchaseOrderId!: string | null;

  /** Set only by payout confirmation (finance.md §4.2). */
  @Column({ type: 'uuid', name: 'payout_id', nullable: true })
  payoutId!: string | null;

  /** Twin voucher of a reversal pair (finance.md §3.4). */
  @Column({ type: 'varchar', length: 50, name: 'reversed_by_voucher_no', nullable: true })
  reversedByVoucherNo!: string | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
