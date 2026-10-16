import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** System-level marketplace master data (OZON / WB / YANDEX) - admin owned. */
@Entity('platforms')
export class PlatformEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  /**
   * 平台之间的分配优先级（用户指示 2026-10-16，ADR 0022）：数值小=优先，
   * 与 warehouse_platform_bindings.priority 同向。只用于缺货到货后
   * 「平台 > 发货时限」的候选行排序，不影响任何状态机。种子三平台同值 100。
   */
  @Column({ type: 'integer', default: 100 })
  priority!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
