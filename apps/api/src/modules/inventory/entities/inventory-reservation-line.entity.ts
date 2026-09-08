import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InventoryReservationEntity } from './inventory-reservation.entity';
import { ReservationLineStatus } from '../enums/inventory.constants';

/**
 * Reservation LINE (task §25-§26/§32): the per-bin allocation of a
 * reservation header. picked_qty supports partial picking (one scan = one
 * unit); shipped_qty supports partial shipping across multiple shipments
 * (Sprint 4) - the line is CONSUMED only when shipped_qty reaches picked_qty.
 */
@Entity('inventory_reservation_lines')
@Index('idx_inventory_reservation_lines_reservation', ['reservationId'])
export class InventoryReservationLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'reservation_id' })
  reservationId!: string;

  @Column({ type: 'uuid', name: 'bin_id' })
  binId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3 })
  quantity!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'picked_qty', default: '0' })
  pickedQty!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'shipped_qty', default: '0' })
  shippedQty!: string;

  @Column({ type: 'varchar', length: 30 })
  status!: ReservationLineStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => InventoryReservationEntity, (reservation) => reservation.lines)
  @JoinColumn({ name: 'reservation_id' })
  reservation?: InventoryReservationEntity;
}

export const RESERVATION_LINE_STATUS_ACTIVE: ReservationLineStatus = 'ACTIVE';
