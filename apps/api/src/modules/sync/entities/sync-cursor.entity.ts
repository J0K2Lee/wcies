import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Per (store_id, sync_type) cursor (Sprint 5 task §13/§46).
 *
 * `cursorData` is the adapter-owned opaque state - never shared across
 * stores, never platform-level. `consecutiveFailures` feeds the store sync
 * tab and the scheduler backoff.
 */
@Entity('sync_cursors')
@Index('uq_sync_cursors_store_type', ['storeId', 'syncType'], { unique: true })
export class SyncCursorEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @Column({ type: 'varchar', length: 40, name: 'sync_type' })
  syncType!: string;

  @Column({ type: 'jsonb', name: 'cursor_data', nullable: true })
  cursorData!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', name: 'last_success_at', nullable: true })
  lastSuccessAt!: Date | null;

  @Column({ type: 'integer', name: 'consecutive_failures', default: 0 })
  consecutiveFailures!: number;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
