import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NotificationChannel, NotificationStatus } from '../enums/notification.constants';

/**
 * Notification (Sprint 4 task §47): one row per domain event per channel.
 * SYSTEM rows are the in-app fact (created SENT); FEISHU rows are outbound
 * deliveries (PENDING -> queue -> SENT/FAILED, retryable). Notification
 * failures never break the publishing business transaction (task §51).
 */
@Entity('notifications')
@Index('idx_notifications_type', ['type'])
@Index('idx_notifications_channel_status', ['channel', 'status'])
@Index('idx_notifications_reference', ['referenceType', 'referenceId'])
@Index('idx_notifications_created_at', ['createdAt'])
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 60 })
  type!: string;

  @Column({ type: 'varchar', length: 20 })
  channel!: NotificationChannel;

  @Column({ type: 'varchar', length: 40, name: 'reference_type' })
  referenceType!: string;

  @Column({ type: 'uuid', name: 'reference_id' })
  referenceId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recipient!: string | null;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  content!: string;

  /**
   * 去重键（2026-10-26）：同一事件在窗口内只记一条（如某个拦截任务重复失败）。
   * null = 不去重。
   */
  @Column({ type: 'varchar', length: 200, name: 'dedupe_key', nullable: true })
  dedupeKey!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: NotificationStatus;

  @Column({ type: 'integer', name: 'attempt_count', default: 0 })
  attemptCount!: number;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamptz', name: 'sent_at', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'failed_at', nullable: true })
  failedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
