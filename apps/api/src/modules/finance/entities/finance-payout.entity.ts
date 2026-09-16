import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FinancePayoutStatus } from '../enums/finance.constants';

/** Platform payout batch (finance.md §4). DRAFT -> CONFIRMED | CANCELLED. */
@Entity('finance_payouts')
@Index('uq_finance_payouts_no', ['payoutNo'], { unique: true })
@Index('idx_finance_payouts_store_period', ['storeId', 'periodStart'])
export class FinancePayoutEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, name: 'payout_no' })
  payoutNo!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @Column({ type: 'timestamptz', name: 'period_start' })
  periodStart!: Date;

  @Column({ type: 'timestamptz', name: 'period_end' })
  periodEnd!: Date;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  amount!: string;

  @Column({ type: 'varchar', length: 10, name: 'currency', default: 'CNY' })
  currency!: string;

  @Column({ type: 'varchar', length: 20, name: 'status', default: 'DRAFT' })
  status!: FinancePayoutStatus;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
