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
import { ReturnBatchEntity } from './return-batch.entity';
import { ReturnItemCondition } from '../enums/return.constants';

/**
 * One line of a return batch (dual-axis T5, returns.md §3.1). Lines are
 * immutable once the batch is RECEIVED; the condition verdict is one-shot
 * (write-once) - SELLABLE/DEFECTIVE write stock back through
 * InventoryService, LOST writes nothing.
 */
@Entity('return_batch_items')
@Index('idx_return_batch_items_batch', ['batchId'])
@Index('uq_return_batch_items_platform_return', ['platformReturnId'], {
  unique: true,
  where: 'platform_return_id IS NOT NULL',
})
export class ReturnBatchItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'batch_id' })
  batchId!: string;

  /**
   * Linked platform return record; NULL = manually registered line (goods
   * that cannot be traced to a platform record - the meeting-notes
   * fallback). UNIQUE when present: one platform record is linked by at
   * most one batch line (reconciliation anchor, returns.md §3.4).
   */
  @Column({ type: 'uuid', name: 'platform_return_id', nullable: true })
  platformReturnId!: string | null;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3 })
  quantity!: string;

  @Column({ type: 'varchar', length: 20 })
  condition!: ReturnItemCondition;

  /** Stock write-back target bin; NULL at inspection -> warehouse STAGING. */
  @Column({ type: 'uuid', name: 'bin_id', nullable: true })
  binId!: string | null;

  /**
   * 到货时扫到的序列号（SN 商品专用，2026-11-04）：扫满 quantity 才入库，
   * 入库时原样传给 inventory（RETURN_RECEIPT 的 SN 明细）。
   */
  @Column({ type: 'text', name: 'received_serial_numbers', array: true, nullable: true })
  receivedSerialNumbers!: string[] | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => ReturnBatchEntity)
  @JoinColumn({ name: 'batch_id' })
  batch?: ReturnBatchEntity;
}
