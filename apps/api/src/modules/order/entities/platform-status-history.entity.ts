import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderEntity } from './order.entity';

/**
 * Platform status transition history (Sprint 9 planning T1, decision 5 = B).
 *
 * Deliberately separate from OrderStatusHistoryEntity: this table records
 * RAW platform status strings written by the sync engine, never ERP states,
 * and never participates in the ERP state machine (orders.md §1). The order
 * detail view merges both timelines by created_at.
 */
@Entity('platform_status_history')
@Index('idx_platform_status_history_order', ['orderId', 'createdAt'])
export class PlatformStatusHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @Column({ type: 'varchar', length: 64, name: 'from_status', nullable: true })
  fromStatus!: string | null;

  @Column({ type: 'varchar', length: 64, name: 'to_status' })
  toStatus!: string;

  /** Channel that delivered the fact (ORDER_SYNC / WEBHOOK / ...). */
  @Column({ type: 'varchar', length: 30, nullable: true })
  source!: string | null;

  /**
   * When the PLATFORM says the transition happened (dual-axis T2). Webhook
   * source: the event payload's changed_state_date; re-read source: the
   * mapper's platformStageChangedAt. NULL when neither is available - then
   * created_at (our observation) is the fallback, per docs §2.4.
   */
  @Column({ type: 'timestamptz', name: 'platform_changed_at', nullable: true })
  platformChangedAt!: Date | null;

  @Column({ type: 'varchar', length: 100, name: 'operator_name', nullable: true })
  operatorName!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => OrderEntity)
  @JoinColumn({ name: 'order_id' })
  order?: OrderEntity;
}
