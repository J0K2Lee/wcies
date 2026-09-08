import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InventoryReservationLineEntity } from './inventory-reservation-line.entity';
import { ReservationStatus, ReservationReferenceType } from '../enums/inventory.constants';

/**
 * Reservation HEADER (task §13/§26): one business demand for one SKU in one
 * warehouse, with per-bin allocation lines. Decoupled from the future Order
 * module via generic reference_type/reference_id (task §14).
 * idempotency_key is UNIQUE - a repeated business event replays the first
 * result instead of reserving twice (task §22/§61).
 */
@Entity('inventory_reservations')
@Index('uq_inventory_reservations_no', ['reservationNo'], { unique: true })
@Index('uq_inventory_reservations_idem', ['idempotencyKey'], { unique: true })
@Index('idx_inventory_reservations_status', ['status'])
@Index('idx_inventory_reservations_reference', ['referenceType', 'referenceId'])
@Index('idx_inventory_reservations_sku_wh', ['skuId', 'warehouseId'])
export class InventoryReservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, name: 'reservation_no' })
  reservationNo!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 30, name: 'reference_type' })
  referenceType!: ReservationReferenceType;

  @Column({ type: 'uuid', name: 'reference_id' })
  referenceId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'requested_qty' })
  requestedQty!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: ReservationStatus;

  @Column({ type: 'varchar', length: 200, name: 'idempotency_key' })
  idempotencyKey!: string;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'picked_at', nullable: true })
  pickedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'released_at', nullable: true })
  releasedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'consumed_at', nullable: true })
  consumedAt!: Date | null;

  @OneToMany(() => InventoryReservationLineEntity, (line) => line.reservation)
  lines?: InventoryReservationLineEntity[];
}
