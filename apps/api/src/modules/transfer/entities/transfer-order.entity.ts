import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TransferOrderStatus } from '../enums/transfer.constants';
import { TransferOrderLineEntity } from './transfer-order-line.entity';

/** Warehouse-to-warehouse transfer intent (transfer.md §2). */
@Entity('transfer_orders')
@Index('uq_transfer_orders_no', ['transferNo'], { unique: true })
@Index('idx_transfer_orders_status', ['status'])
export class TransferOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, name: 'transfer_no' })
  transferNo!: string;

  @Column({ type: 'uuid', name: 'from_warehouse_id' })
  fromWarehouseId!: string;

  @Column({ type: 'uuid', name: 'to_warehouse_id' })
  toWarehouseId!: string;

  @Column({ type: 'varchar', length: 20, name: 'status', default: 'DRAFT' })
  status!: TransferOrderStatus;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => TransferOrderLineEntity, (line) => line.transfer)
  lines?: TransferOrderLineEntity[];
}
