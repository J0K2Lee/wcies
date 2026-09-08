import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InventoryCondition } from '../enums/inventory.constants';

/**
 * Physical inventory balance (task §5-§9): "how much is where, right now".
 *
 * UNIQUE(sku, warehouse, bin, condition); quantities are NUMERIC(18,3)
 * strings (see common/utils/quantity.ts for the milli-unit strategy).
 * Available is NEVER stored - it is derived (task §10, inventory.md §6).
 * Zero rows are kept so "record with 0" differs from "no record"
 * (NO_INVENTORY_RECORD != ZERO, task §78).
 */
@Entity('inventory_balances')
@Index('uq_inventory_balances_dim', ['skuId', 'warehouseId', 'binId', 'inventoryCondition'], {
  unique: true,
})
@Index('idx_inventory_balances_wh_sku', ['warehouseId', 'skuId'])
export class InventoryBalanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'uuid', name: 'bin_id' })
  binId!: string;

  @Column({ type: 'varchar', length: 30, name: 'inventory_condition', default: 'SELLABLE' })
  inventoryCondition!: InventoryCondition;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'on_hand_qty', default: '0' })
  onHandQty!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'reserved_qty', default: '0' })
  reservedQty!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'picked_qty', default: '0' })
  pickedQty!: string;

  @Column({ type: 'bigint', default: '0' })
  version!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
