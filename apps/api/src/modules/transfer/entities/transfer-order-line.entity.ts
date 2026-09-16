import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TransferOrderEntity } from './transfer-order.entity';

/** One transfer line: quantity of a SKU from source bin to destination bin. */
@Entity('transfer_order_lines')
@Index('idx_transfer_order_lines_transfer', ['transferId'])
@Index('idx_transfer_order_lines_sku', ['skuId'])
export class TransferOrderLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'transfer_id' })
  transferId!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3 })
  quantity!: string;

  @Column({ type: 'uuid', name: 'from_bin_id', nullable: true })
  fromBinId!: string | null;

  @Column({ type: 'uuid', name: 'to_bin_id', nullable: true })
  toBinId!: string | null;

  /** Ledger event numbers written at confirmation (transfer.md §5). */
  @Column({ type: 'varchar', length: 50, name: 'out_event_no', nullable: true })
  outEventNo!: string | null;

  @Column({ type: 'varchar', length: 50, name: 'in_event_no', nullable: true })
  inEventNo!: string | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => TransferOrderEntity, (transfer) => transfer.lines)
  @JoinColumn({ name: 'transfer_id' })
  transfer?: TransferOrderEntity;
}
