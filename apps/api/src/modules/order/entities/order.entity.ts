import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ErpOrderStatus } from '../enums/order.constants';
import { OrderItemEntity } from './order-item.entity';

/**
 * Order HEADER (Sprint 3 task §4).
 *
 * Business uniqueness is (store_id, platform_order_id); platform order ids
 * may repeat across stores (AGENTS.md §35). platform_status is a stored
 * FACT - it is never copied into erp_status, which belongs to the
 * OrderStatusService state machine (AGENTS.md §38).
 */
@Entity('orders')
@Index('uq_orders_no', ['orderNo'], { unique: true })
@Index('uq_orders_store_platform', ['storeId', 'platformOrderId'], { unique: true })
@Index('idx_orders_erp_status', ['erpStatus'])
@Index('idx_orders_store', ['storeId'])
@Index('idx_orders_ordered_at', ['orderedAt'])
@Index('idx_orders_store_ordered', ['storeId', 'orderedAt'])
@Index('idx_orders_store_stage', ['storeId', 'platformStage'])
@Index('idx_orders_erp_status_stage', ['erpStatus', 'platformStage'])
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, name: 'order_no' })
  orderNo!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @Column({ type: 'varchar', length: 255, name: 'platform_order_id' })
  platformOrderId!: string;

  @Column({ type: 'varchar', length: 64, name: 'platform_status', nullable: true })
  platformStatus!: string | null;

  /**
   * Normalized platform logistics stage (dual-axis task T1, 2026-09-15):
   * AWAITING_SHIPMENT / IN_TRANSIT / DELIVERED / CANCELLED, or null when the
   * platform vocabulary value is unclassified or not yet synced. A platform
   * FACT about where the goods are - never copied into erp_status (§38).
   */
  @Column({ type: 'varchar', length: 30, name: 'platform_stage', nullable: true })
  platformStage!: string | null;

  /**
   * Platform's OWN timestamp for entering `platformStage` (OZON
   * delivering_date / fact_delivery_date; webhook changed_state_date). The
   * stall clock anchors HERE, not on our receive time (docs §2.4) - falls
   * back to the migration-row observation time when the platform omits it.
   */
  @Column({ type: 'timestamptz', name: 'platform_stage_changed_at', nullable: true })
  platformStageChangedAt!: Date | null;

  /**
   * Last time the fallback re-read pass CONFIRMED this order's platform facts
   * (whether or not anything changed). Drives the fair round-robin candidate
   * rotation (docs §3 T2) - NOT a business fact, purely a scheduling cursor.
   */
  @Column({ type: 'timestamptz', name: 'platform_facts_checked_at', nullable: true })
  platformFactsCheckedAt!: Date | null;

  @Column({ type: 'varchar', length: 40, name: 'erp_status' })
  erpStatus!: ErpOrderStatus;

  @Column({ type: 'varchar', length: 40, name: 'fulfillment_mode', nullable: true })
  fulfillmentMode!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency!: string | null;

  @Column({ type: 'timestamptz', name: 'ordered_at' })
  orderedAt!: Date;

  /**
   * Platform-required ship-by time (OZON shipment_date). A platform FACT,
   * never an ERP state (AGENTS.md §38): display/exception only. Nullable -
   * platforms may omit it and the mapper tolerates missing/invalid values.
   */
  @Column({ type: 'timestamptz', name: 'shipment_deadline', nullable: true })
  shipmentDeadline!: Date | null;

  @Column({ type: 'jsonb', name: 'raw_data', nullable: true })
  rawData!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  /** How the order entered WCIES (Sprint 5 §58): MANUAL / API / POLLING / WEBHOOK. */
  @Column({ type: 'varchar', length: 30, name: 'sync_source', nullable: true })
  syncSource!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => OrderItemEntity, (item) => item.order)
  items?: OrderItemEntity[];
}
