import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Physical or platform warehouse (task §35/§36).
 * SELF / SEMI_MANAGED / PLATFORM / THIRD_PARTY / RETURN_TEMP only - no
 * VIRTUAL, no groups. Platform warehouses relate via warehouse_platform_
 * bindings (仓库绑定平台仓库，用户指示 2026-09-17), never warehouse.store_id.
 *
 * 类型 ↔ 履约模式兼容（服务层校验，platform.constants）：
 *   SELF / THIRD_PARTY  → 自管模式（OZON rFBS / FBS）
 *   SEMI_MANAGED        → 半托管（OZON FBP）
 *   PLATFORM（托管仓）  → 平台履约（OZON FBO）；且只允许绑定一个平台仓库
 */
@Entity('warehouses')
export class WarehouseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, name: 'warehouse_code', unique: true })
  warehouseCode!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 30, name: 'warehouse_type' })
  warehouseType!: string;

  @Column({ type: 'varchar', length: 10, name: 'country_code', nullable: true })
  countryCode!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  province!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'contact_name', nullable: true })
  contactName!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'contact_phone', nullable: true })
  contactPhone!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

export const WAREHOUSE_TYPES = [
  'SELF',
  'SEMI_MANAGED',
  'PLATFORM',
  'THIRD_PARTY',
  'RETURN_TEMP',
] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

export const WAREHOUSE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type WarehouseStatus = (typeof WAREHOUSE_STATUSES)[number];
