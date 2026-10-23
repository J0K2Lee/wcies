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
@Index('idx_orders_is_urgent', ['isUrgent'], { where: 'is_urgent = true' })
@Index('idx_orders_label_printed', ['labelPrintedAt'], { where: 'label_printed_at IS NOT NULL' })
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

  /**
   * Platform-assigned waybill/tracking number (OZON `tracking_number`),
   * 2026-09-18 order fulfillment flow. A platform FACT for display and for
   * filling the internal Shipment's tracking number at outbound time - it
   * does NOT make the order the logistics model (AGENTS.md §37: Shipment /
   * Package stay the only carrier). Null while the platform has not assigned
   * one; `raw_data` keeps the verbatim original (AGENTS.md §34).
   */
  @Column({ type: 'varchar', length: 255, name: 'platform_tracking_no', nullable: true })
  platformTrackingNo!: string | null;

  @Column({ type: 'jsonb', name: 'raw_data', nullable: true })
  rawData!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  /**
   * 加急标记（用户指示 2026-10-16，ADR 0022）：人工标注的业务属性，不是
   * ERP 状态（AGENTS.md §38）——不进 erp_status、不参与状态机，只影响订单
   * 列表置顶与缺货到货后的库存分配排序。`urgentMarkedAt` 记录最近一次标记
   * 加急的时间（审计）；取消加急后保留最后一次标记时间。
   */
  @Column({ type: 'boolean', name: 'is_urgent', default: false })
  isUrgent!: boolean;

  @Column({ type: 'timestamptz', name: 'urgent_marked_at', nullable: true })
  urgentMarkedAt!: Date | null;

  /**
   * 面单已打印时间（用户指示 2026-10-19）：人工确认（浏览器无法感知打印
   * 结果），仅用于「已打印」胶囊与「已打单」筛选（= 已打印 ∧ 未发货）。
   * 不是 ERP 状态，不属于状态机。
   */
  @Column({ type: 'timestamptz', name: 'label_printed_at', nullable: true })
  labelPrintedAt!: Date | null;

  /**
   * 手工「标记外部履约」的时间与原因（2026-10-23 用户需求）。NULL = 从未标记。
   *
   * 标记会把订单关账为 SHIPPED，但平台侧可能还没真正发货；本字段让系统能区分
   * 「我手工关账的外部履约」与「真的出库了」，从而提供「取消外部履约」——
   * 未标记的单不出现该入口，已标记但平台已开始运输的单也不允许回退。
   */
  @Column({ type: 'timestamptz', name: 'external_fulfilled_at', nullable: true })
  externalFulfilledAt!: Date | null;

  @Column({ type: 'varchar', length: 500, name: 'external_fulfillment_reason', nullable: true })
  externalFulfillmentReason!: string | null;

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
