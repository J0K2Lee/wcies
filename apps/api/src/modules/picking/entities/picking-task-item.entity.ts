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
/**
 * 一个订单行同时只允许一条「有效」拣货行（2026-11-04 改部分唯一）：
 * CANCELLED 行是撤出审计（订单取消/行取消），保留它们不能再挡住「该行重新
 * 分配后再次生成拣货任务」——旧的全表唯一约束会让这里 500
 * (`duplicate key ... uq_picking_task_items_order_item`)。
 */
@Index('uq_picking_task_items_order_item_active', ['orderItemId'], {
  unique: true,
  where: "status <> 'CANCELLED'",
})
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

  /** 因订单取消而撤出的数量（required − picked）；未取消的行恒为 0。 */
  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'cancelled_qty', default: '0' })
  cancelledQty!: string;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt!: Date | null;

  @Column({ type: 'varchar', length: 500, name: 'cancel_reason', nullable: true })
  cancelReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => PickingTaskEntity, (task) => task.items)
  @JoinColumn({ name: 'picking_task_id' })
  task?: PickingTaskEntity;
}
