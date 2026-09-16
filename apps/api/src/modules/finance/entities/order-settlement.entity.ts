import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderSettlementItemEntity } from './order-settlement-item.entity';

/**
 * Per-order revenue/cost/profit snapshot for SHIPPED orders (finance.md §5).
 * Cost is frozen at generation time; only shipping_fee / other_fee stay
 * editable afterwards (they re-derive profit, never the line snapshots).
 */
@Entity('order_settlements')
@Index('uq_order_settlements_order', ['orderId'], { unique: true })
@Index('idx_order_settlements_generated', ['generatedAt'])
export class OrderSettlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'revenue_total', default: '0' })
  revenueTotal!: string;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 4,
    name: 'product_cost_total',
    default: '0',
  })
  productCostTotal!: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'shipping_fee', default: '0' })
  shippingFee!: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'other_fee', default: '0' })
  otherFee!: string;

  /** NULL when order currency differs from CNY (finance.md §5.3 rule 3). */
  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  profit!: string | null;

  @Column({ type: 'boolean', name: 'has_missing_price', default: false })
  hasMissingPrice!: boolean;

  @Column({ type: 'boolean', name: 'has_missing_cost', default: false })
  hasMissingCost!: boolean;

  @Column({ type: 'uuid', name: 'generated_by', nullable: true })
  generatedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'generated_at' })
  generatedAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => OrderSettlementItemEntity, (item) => item.settlement)
  items?: OrderSettlementItemEntity[];
}
