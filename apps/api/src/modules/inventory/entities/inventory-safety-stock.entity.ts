import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Safety stock policy per (sku, warehouse) (task §11-§12).
 * Inventory POLICY, not a physical movement: changing it never touches
 * balances and never writes an InventoryTransaction (inventory.md §41).
 */
@Entity('inventory_safety_stocks')
@Index('uq_inventory_safety_stocks_dim', ['skuId', 'warehouseId'], { unique: true })
export class InventorySafetyStockEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'safety_qty', default: '0' })
  safetyQty!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
