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
import { PurchaseOrderEntity } from './purchase-order.entity';

/**
 * Purchase order ITEM (Sprint 7 task §10). order_item_id is NULL for
 * stock-up purchases; linked lines are the basis of the derived per-line
 * procurement state and of the anti-duplicate-ordering guard.
 */
@Entity('purchase_order_items')
@Index('idx_purchase_order_items_po', ['poId'])
@Index('idx_purchase_order_items_order_item', ['orderItemId'])
@Index('idx_purchase_order_items_sku', ['skuId'])
export class PurchaseOrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'po_id' })
  poId!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  /** Which order line this buys for; NULL = stock-up purchase. */
  @Column({ type: 'uuid', name: 'order_item_id', nullable: true })
  orderItemId!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 3 })
  quantity!: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'unit_cost', nullable: true })
  unitCost!: string | null;

  /** Accumulated ONLY by receipt confirmation (T4). */
  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'received_quantity' })
  receivedQuantity!: string;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => PurchaseOrderEntity)
  @JoinColumn({ name: 'po_id' })
  order?: PurchaseOrderEntity;
}
