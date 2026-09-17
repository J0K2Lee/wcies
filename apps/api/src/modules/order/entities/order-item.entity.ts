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
import { OrderItemFulfillmentStatus, OrderItemMappingStatus } from '../enums/order.constants';
import { OrderEntity } from './order.entity';

/**
 * Order ITEM (Sprint 3 task §6-§8): each line owns its SKU mapping and its
 * inventory fulfillment state, so one failing line never blocks the order
 * (AGENTS.md §36). reservation_id (referenceType=ORDER) links the line to
 * the InventoryReservation created for it.
 */
@Entity('order_items')
@Index('uq_order_items_order_line', ['orderId', 'lineNo'], { unique: true })
@Index('idx_order_items_order', ['orderId'])
@Index('idx_order_items_sku', ['skuId'])
@Index('idx_order_items_reservation', ['reservationId'])
@Index('idx_order_items_fulfillment', ['fulfillmentStatus'])
export class OrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @Column({ type: 'integer', name: 'line_no' })
  lineNo!: number;

  @Column({ type: 'varchar', length: 255, name: 'platform_product_id', nullable: true })
  platformProductId!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'platform_sku_id', nullable: true })
  platformSkuId!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'seller_sku', nullable: true })
  sellerSku!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'offer_id', nullable: true })
  offerId!: string | null;

  /** Public platform CDN URL; display-only, never an internal SKU identity. */
  @Column({ type: 'text', name: 'platform_image_url', nullable: true })
  platformImageUrl: string | null = null;

  @Column({ type: 'uuid', name: 'listing_sku_id', nullable: true })
  listingSkuId!: string | null;

  @Column({ type: 'uuid', name: 'sku_id', nullable: true })
  skuId!: string | null;

  /** Warehouse the line was reserved in (set on successful allocation). */
  @Column({ type: 'uuid', name: 'warehouse_id', nullable: true })
  warehouseId!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 3 })
  quantity!: string;

  /** Platform unit sale price (finance.md §2); NULL = platform gave none. */
  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'unit_price', nullable: true })
  unitPrice!: string | null;

  /** unit_price × quantity, computed at write time (finance.md §2). */
  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'total_price', nullable: true })
  totalPrice!: string | null;

  @Column({ type: 'varchar', length: 30, name: 'fulfillment_status' })
  fulfillmentStatus!: OrderItemFulfillmentStatus;

  @Column({ type: 'varchar', length: 30, name: 'mapping_status' })
  mappingStatus!: OrderItemMappingStatus;

  @Column({ type: 'uuid', name: 'reservation_id', nullable: true })
  reservationId!: string | null;

  @Column({ type: 'jsonb', name: 'raw_data', nullable: true })
  rawData!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => OrderEntity, (order) => order.items)
  @JoinColumn({ name: 'order_id' })
  order?: OrderEntity;
}
