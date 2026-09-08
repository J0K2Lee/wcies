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
 * Order status history (Sprint 3 task §9 / §82): EVERY erp_status change
 * leaves a row. Updating orders.erp_status without history is an
 * architecture violation (AGENTS.md §39).
 */
@Entity('order_status_history')
@Index('idx_order_status_history_order', ['orderId', 'createdAt'])
export class OrderStatusHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @Column({ type: 'varchar', length: 40, name: 'from_status', nullable: true })
  fromStatus!: string | null;

  @Column({ type: 'varchar', length: 40, name: 'to_status' })
  toStatus!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({ type: 'uuid', name: 'operator_id', nullable: true })
  operatorId!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'operator_name', nullable: true })
  operatorName!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => OrderEntity)
  @JoinColumn({ name: 'order_id' })
  order?: OrderEntity;
}
