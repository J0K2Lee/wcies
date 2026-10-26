import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 通知订阅（2026-10-26）：一行 = 某人 × 某通道 × 某事件 × 一组条件。
 *
 * 条件语义（刻意保持简单）：**所有键值 AND**，值为候选集合，payload 字段命中任一
 * 即算满足该键；没有否定规则、没有布尔表达式——规则必须能被一句话讲清并解释
 * 「为什么收到/没收到」。
 *
 * 默认没有任何订阅（用户指示：全不订阅）；站内事件流不受订阅影响。
 */
@Entity('notification_subscriptions')
@Index('idx_notification_subscriptions_event', ['eventType', 'enabled'])
export class NotificationSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 20 })
  channel!: string;

  @Column({ type: 'varchar', length: 60, name: 'event_type' })
  eventType!: string;

  /** `{ "storeId": ["..."], "level": ["HIGH"] }`；空对象 = 该事件全收。 */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  conditions!: Record<string, string[]>;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
