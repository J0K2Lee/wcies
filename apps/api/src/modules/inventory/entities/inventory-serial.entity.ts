import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InventorySerialStatus } from '../enums/inventory.constants';

/**
 * Serial-tracked unit detail (Sprint 3 task §42-§43).
 *
 * A serial is NOT a second stock fact source: quantities live on
 * inventory_balances and both are written in the SAME transaction.
 * reservation_id / picking_task_item_id trace who occupies the unit.
 * SHIPPED is reserved for the Shipment sprint.
 */
@Entity('inventory_serials')
@Index('uq_inventory_serials_serial', ['serialNumber'], { unique: true })
@Index('idx_inventory_serials_sku_wh_status', ['skuId', 'warehouseId', 'status'])
@Index('idx_inventory_serials_reservation', ['reservationId'])
@Index('idx_inventory_serials_picking_item', ['pickingTaskItemId'])
export class InventorySerialEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, name: 'serial_number' })
  serialNumber!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'uuid', name: 'bin_id', nullable: true })
  binId!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'IN_STOCK' })
  status!: InventorySerialStatus;

  @Column({ type: 'uuid', name: 'reservation_id', nullable: true })
  reservationId!: string | null;

  @Column({ type: 'uuid', name: 'picking_task_item_id', nullable: true })
  pickingTaskItemId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
