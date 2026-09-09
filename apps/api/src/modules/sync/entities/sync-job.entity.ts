import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One synchronization run (Sprint 5 task §11): "no unrecorded syncs".
 *
 * Single-flight guard: partial unique index (store_id, sync_type) WHERE
 * status IN (PENDING, RUNNING) - the DB refuses a second active job for the
 * same store + sync type even under concurrent dispatch (task §15/§53).
 */
@Entity('sync_jobs')
@Index('uq_sync_jobs_active', ['storeId', 'syncType'], {
  unique: true,
  where: `status IN ('PENDING', 'RUNNING')`,
})
@Index('idx_sync_jobs_store_created', ['storeId', 'createdAt'])
export class SyncJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @Column({ type: 'varchar', length: 40, name: 'sync_type' })
  syncType!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ type: 'varchar', length: 20, name: 'trigger_type', default: 'MANUAL' })
  triggerType!: string;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'jsonb', name: 'cursor_before', nullable: true })
  cursorBefore!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', name: 'cursor_after', nullable: true })
  cursorAfter!: Record<string, unknown> | null;

  @Column({ type: 'integer', name: 'success_count', default: 0 })
  successCount!: number;

  @Column({ type: 'integer', name: 'failed_count', default: 0 })
  failedCount!: number;

  @Column({ type: 'integer', name: 'skipped_count', default: 0 })
  skippedCount!: number;

  @Column({ type: 'integer', name: 'retry_count', default: 0 })
  retryCount!: number;

  @Column({ type: 'varchar', length: 60, name: 'error_code', nullable: true })
  errorCode!: string | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
