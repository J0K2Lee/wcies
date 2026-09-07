import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Store N:M Warehouse with fulfillment semantics (task §42-§45).
 * Platform-specific fulfillment modes live HERE and in the platform
 * constants - never in the inventory core (AGENTS.md §31).
 */
@Entity('store_warehouse_bindings')
@Index('idx_swb_store', ['storeId'])
@Index('idx_swb_warehouse', ['warehouseId'])
export class StoreWarehouseBindingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 50, name: 'fulfillment_mode' })
  fulfillmentMode!: string;

  @Column({ type: 'varchar', length: 255, name: 'platform_warehouse_id', nullable: true })
  platformWarehouseId!: string | null;

  @Column({ type: 'boolean', name: 'is_inventory_source', default: true })
  isInventorySource!: boolean;

  @Column({ type: 'boolean', name: 'is_inventory_push_enabled', default: false })
  isInventoryPushEnabled!: boolean;

  @Column({ type: 'integer', default: 100 })
  priority!: number;

  @Column({ type: 'jsonb', nullable: true })
  settings!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
