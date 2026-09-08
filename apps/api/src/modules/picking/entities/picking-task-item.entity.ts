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
import { PickingItemStatus } from '../enums/picking.constants';
import { PickingTaskEntity } from './picking-task.entity';

/**
 * Picking task ITEM (Sprint 3 task §29/§39-§40). picked_qty accumulates one
 * unit per successful scan; the DB CHECK picked_qty <= required_qty plus the
 * atomic increment guard stop over-picking under concurrency (task §85).
 * order_item_id is UNIQUE: a line is picked by at most one task.
 */
@Entity('picking_task_items')
@Index('uq_picking_task_items_order_item', ['orderItemId'], { unique: true })
@Index('idx_picking_task_items_task', ['pickingTaskId'])
@Index('idx_picking_task_items_order', ['orderId'])
@Index('idx_picking_task_items_sku', ['skuId'])
@Index('idx_picking_task_items_status', ['status'])
export class PickingTaskItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'picking_task_id' })
  pickingTaskId!: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @Column({ type: 'uuid', name: 'order_item_id' })
  orderItemId!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'uuid', name: 'reservation_id' })
  reservationId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'required_qty' })
  requiredQty!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'picked_qty', default: '0' })
  pickedQty!: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: PickingItemStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => PickingTaskEntity, (task) => task.items)
  @JoinColumn({ name: 'picking_task_id' })
  task?: PickingTaskEntity;
}
