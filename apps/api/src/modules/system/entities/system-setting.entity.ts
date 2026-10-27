import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 系统级运行参数（2026-10-27）。缺省值写在代码里，表里只存运营改过的覆盖值；
 * 值用 JSONB，读取方负责形状校验（见 SystemSettingsService）。
 */
@Entity('system_settings')
export class SystemSettingEntity {
  @PrimaryColumn({ type: 'varchar', length: 80 })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: Record<string, unknown>;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy!: string | null;
}
