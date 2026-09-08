import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderEntity } from './order.entity';
import { OrderItemEntity } from './order-item.entity';
import { OrderInterceptionStatus } from '../enums/order.constants';

/**
 * Order interception (Sprint 3 task §56-§57): created when a PICKED order
 * line is cancelled. The physical unit must be found and returned to stock;
 * cancelling NEVER auto-restores availability (AGENTS.md §42). Sprint 3
 * implements creation only (status CREATED).
 */
@Entity('order_interceptions')
@Index('uq_order_interceptions_no', ['interceptionNo'], { unique: true })
@Index('idx_order_interceptions_order', ['orderId'])
@Index('idx_order_interceptions_status', ['status'])
export class OrderInterceptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, name: 'interception_no' })
  interceptionNo!: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @Column({ type: 'uuid', name: 'order_item_id', nullable: true })
  orderItemId!: string | null;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 30, default: 'CREATED' })
  status!: OrderInterceptionStatus;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'uuid', name: 'assigned_to', nullable: true })
  assignedTo!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'assigned_at', nullable: true })
  assignedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'intercepted_at', nullable: true })
  interceptedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'returned_to_stock_at', nullable: true })
  returnedToStockAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'closed_at', nullable: true })
  closedAt!: Date | null;

  @ManyToOne(() => OrderEntity)
  @JoinColumn({ name: 'order_id' })
  order?: OrderEntity;

  @ManyToOne(() => OrderItemEntity)
  @JoinColumn({ name: 'order_item_id' })
  orderItem?: OrderItemEntity;
}
