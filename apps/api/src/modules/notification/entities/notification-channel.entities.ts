import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 每人每通道的投递地址（飞书 open_id / 邮箱）。一人一通道一行。 */
@Entity('user_channel_bindings')
export class UserChannelBindingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  /** FEISHU_DM / EMAIL（群通道是组织级配置，不按人绑定）。 */
  @Column({ type: 'varchar', length: 20 })
  channel!: string;

  @Column({ type: 'varchar', length: 255 })
  address!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'timestamptz', name: 'verified_at', nullable: true })
  verifiedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

/** 每人每事件的已读状态；没有行 = 未读。 */
@Entity('notification_reads')
export class NotificationReadEntity {
  @PrimaryColumn({ type: 'uuid', name: 'notification_id' })
  notificationId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'timestamptz', name: 'read_at', default: () => 'now()' })
  readAt!: Date;
}

/** 一次推送尝试（事件 × 用户 × 通道 × 规则）。 */
@Entity('notification_deliveries')
export class NotificationDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'notification_id' })
  notificationId!: string;

  /** null = 组织级投递（飞书群）。 */
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 20 })
  channel!: string;

  @Column({ type: 'uuid', name: 'rule_id', nullable: true })
  ruleId!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

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

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
