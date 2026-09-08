import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Interception status history (Sprint 4 task §41): append-only log of every
 * transition, including internally collapsed steps (e.g. LOCATING ->
 * RETURNED_TO_STOCK recorded as LOCATING -> INTERCEPTED -> RETURNED_TO_STOCK).
 */
@Entity('order_interception_histories')
@Index('idx_order_interception_histories_interception', ['interceptionId'])
export class OrderInterceptionHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'interception_id' })
  interceptionId!: string;

  @Column({ type: 'varchar', length: 30, name: 'from_status', nullable: true })
  fromStatus!: string | null;

  @Column({ type: 'varchar', length: 30, name: 'to_status' })
  toStatus!: string;

  @Column({ type: 'varchar', length: 40 })
  action!: string;

  @Column({ type: 'uuid', name: 'operator_id', nullable: true })
  operatorId!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'operator_name', default: 'system' })
  operatorName!: string;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
