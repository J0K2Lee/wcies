import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ReturnBatchStatus } from '../enums/return.constants';

/**
 * Return batch HEADER (dual-axis T5, returns.md §3): the PHYSICAL work
 * document. A batch is a unit of returned goods (may mix orders / platform
 * records); it is the ONLY path that writes stock back, and only at
 * inspection time. Reconciliation anchors on platform_return records, not
 * on batches (the meeting-notes "batch cannot map to one order" reality).
 */
@Entity('return_batches')
@Index('idx_return_batches_status', ['status'])
@Index('idx_return_batches_warehouse', ['warehouseId'])
export class ReturnBatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Business number RT%06d (centralized sequence, scope return_batch). */
  @Column({ type: 'varchar', length: 50, name: 'batch_no', unique: true })
  batchNo!: string;

  /** Receiving warehouse (recommend a dedicated returns/staging warehouse). */
  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: ReturnBatchStatus;

  /** Free-text source note (e.g. "Amol warehouse 9-15 batch"). */
  @Column({ type: 'varchar', length: 500, name: 'source_note', nullable: true })
  sourceNote!: string | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
