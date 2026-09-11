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
import { PurchaseReceiptEntity } from './purchase-receipt.entity';

/**
 * Purchase receipt ITEM (Sprint 7 task §11): what physically arrived this
 * time. serial_numbers keeps the SN input record for serial-tracked SKUs
 * (the structured per-unit facts live in inventory_serials like everywhere
 * else); bin_id may be null - the inventory layer resolves the dimension
 * with its existing no-bin-only-when-warehouse-has-no-bins rule.
 */
@Entity('purchase_receipt_items')
@Index('idx_purchase_receipt_items_receipt', ['receiptId'])
@Index('idx_purchase_receipt_items_po_item', ['purchaseOrderItemId'])
@Index('idx_purchase_receipt_items_sku', ['skuId'])
export class PurchaseReceiptItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'receipt_id' })
  receiptId!: string;

  @Column({ type: 'uuid', name: 'purchase_order_item_id', nullable: true })
  purchaseOrderItemId!: string | null;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3 })
  quantity!: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'unit_cost', nullable: true })
  unitCost!: string | null;

  @Column({ type: 'uuid', name: 'bin_id', nullable: true })
  binId!: string | null;

  /** SN input record (jsonb string[]); required at confirm for SN SKUs. */
  @Column({ type: 'jsonb', name: 'serial_numbers', nullable: true })
  serialNumbers!: string[] | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => PurchaseReceiptEntity)
  @JoinColumn({ name: 'receipt_id' })
  receipt?: PurchaseReceiptEntity;
}
