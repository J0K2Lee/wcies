import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderInterceptionStatus } from '../../order/enums/order.constants';

/**
 * Order interception (Sprint 3 task §56-§57 created it; Sprint 4 task
 * §29-§45 owns the full workflow). Created when a PICKED order line is
 * cancelled: the physical unit must be found and returned to stock through a
 * scanned, validated return - cancelling NEVER auto-restores availability
 * (AGENTS.md §42). Cross-module references stay plain UUID columns.
 */
@Entity('order_interceptions')
@Index('uq_order_interceptions_no', ['interceptionNo'], { unique: true })
@Index('idx_order_interceptions_order', ['orderId'])
@Index('idx_order_interceptions_status', ['status'])
@Index('idx_order_interceptions_warehouse', ['warehouseId'])
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

  @Column({ type: 'varchar', length: 100, name: 'assigned_to_name', nullable: true })
  assignedToName!: string | null;

  /** The bin the operator scanned as the return destination (task §34). */
  @Column({ type: 'uuid', name: 'target_bin_id', nullable: true })
  targetBinId!: string | null;

  /** SKU verified by the interception scan (task §35). */
  @Column({ type: 'uuid', name: 'scanned_sku_id', nullable: true })
  scannedSkuId!: string | null;

  /** SNs verified by the interception scan (task §36). */
  @Column({ type: 'jsonb', name: 'scanned_serial_numbers', nullable: true })
  scannedSerialNumbers!: string[] | null;

  @Column({ type: 'timestamptz', name: 'scanned_at', nullable: true })
  scannedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'failed_at', nullable: true })
  failedAt!: Date | null;

  @Column({ type: 'text', name: 'failed_reason', nullable: true })
  failedReason!: string | null;

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
}
