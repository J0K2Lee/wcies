import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PurchaseReceiptStatus } from '../enums/purchase.constants';

/**
 * Purchase receipt HEADER (Sprint 7 task §11): the irreversible stock-fact
 * document. DRAFT edits freely; RECEIVED never changes quantities again
 * (corrections go through stock adjustments, purchase.md §4.2).
 */
@Entity('purchase_receipts')
@Index('idx_purchase_receipts_po', ['purchaseOrderId'])
@Index('idx_purchase_receipts_warehouse', ['warehouseId'])
@Index('idx_purchase_receipts_status', ['status'])
export class PurchaseReceiptEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Business number PR%06d (centralized sequence, master-data.md §1). */
  @Column({ type: 'varchar', length: 50, name: 'receipt_no', unique: true })
  receiptNo!: string;

  @Column({ type: 'uuid', name: 'purchase_order_id', nullable: true })
  purchaseOrderId!: string | null;

  @Column({ type: 'uuid', name: 'supplier_id', nullable: true })
  supplierId!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'source_note', nullable: true })
  sourceNote!: string | null;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: PurchaseReceiptStatus;

  @Column({ type: 'timestamptz', name: 'received_at', nullable: true })
  receivedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
