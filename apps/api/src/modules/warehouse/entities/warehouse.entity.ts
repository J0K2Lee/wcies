import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Physical or platform warehouse (task §35/§36).
 * SELF / PLATFORM / THIRD_PARTY / RETURN_TEMP only - no VIRTUAL, no groups.
 * Stores relate N:M via store_warehouse_bindings, never warehouse.store_id.
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

export const WAREHOUSE_TYPES = ['SELF', 'PLATFORM', 'THIRD_PARTY', 'RETURN_TEMP'] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

export const WAREHOUSE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type WarehouseStatus = (typeof WAREHOUSE_STATUSES)[number];
