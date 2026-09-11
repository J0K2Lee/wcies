import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PurchaseOrderStatus } from '../enums/purchase.constants';

/**
 * Purchase order HEADER (Sprint 7 task §10): a registration of procurement
 * INTENT. Cancelling is possible before any receipt; stock is NEVER touched
 * by this document (decision 0013 - receipts own the stock facts).
 */
@Entity('purchase_orders')
@Index('idx_purchase_orders_supplier', ['supplierId'])
@Index('idx_purchase_orders_status', ['status'])
export class PurchaseOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Business number PO%06d (centralized sequence, master-data.md §1). */
  @Column({ type: 'varchar', length: 50, name: 'po_no', unique: true })
  poNo!: string;

  @Column({ type: 'uuid', name: 'supplier_id', nullable: true })
  supplierId!: string | null;

  /** Free-text source note for one-off online purchases (<=500 chars). */
  @Column({ type: 'varchar', length: 500, name: 'source_note', nullable: true })
  sourceNote!: string | null;

  @Column({ type: 'varchar', length: 30 })
  status!: PurchaseOrderStatus;

  @Column({ type: 'timestamptz', name: 'ordered_at' })
  orderedAt!: Date;

  @Column({ type: 'timestamptz', name: 'expected_at', nullable: true })
  expectedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
