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

  @Column({ type: 'varchar', length: 40, name: 'erp_status' })
  erpStatus!: ErpOrderStatus;

  @Column({ type: 'varchar', length: 40, name: 'fulfillment_mode', nullable: true })
  fulfillmentMode!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency!: string | null;

  @Column({ type: 'timestamptz', name: 'ordered_at' })
  orderedAt!: Date;

  @Column({ type: 'jsonb', name: 'raw_data', nullable: true })
  rawData!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => OrderItemEntity, (item) => item.order)
  items?: OrderItemEntity[];
}
