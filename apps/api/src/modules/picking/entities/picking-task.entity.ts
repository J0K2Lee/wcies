import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PickingTaskStatus } from '../enums/picking.constants';
import { PickingTaskItemEntity } from './picking-task-item.entity';

/**
 * Picking task HEADER (Sprint 3 task §28/§33): ALWAYS scoped to exactly one
 * warehouse. The model is not bound to one order - items carry their own
 * order references so multi-order consolidation is possible later.
 */
@Entity('picking_tasks')
@Index('uq_picking_tasks_no', ['pickingNo'], { unique: true })
@Index('idx_picking_tasks_warehouse', ['warehouseId'])
@Index('idx_picking_tasks_status', ['status'])
export class PickingTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, name: 'picking_no' })
  pickingNo!: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 20, default: 'CREATED' })
  status!: PickingTaskStatus;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'created_by_name', nullable: true })
  createdByName!: string | null;

  @Column({ type: 'uuid', name: 'assigned_to', nullable: true })
  assignedTo!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'assigned_to_name', nullable: true })
  assignedToName!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt!: Date | null;

  @OneToMany(() => PickingTaskItemEntity, (item) => item.task)
  items?: PickingTaskItemEntity[];
}
