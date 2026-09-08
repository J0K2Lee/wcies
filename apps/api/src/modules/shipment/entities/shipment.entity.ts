import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ShipmentStatus } from '../enums/shipment.constants';
import { ShipmentItemEntity } from './shipment-item.entity';

/**
 * Shipment (Sprint 4 task §7-§9/§14): the warehouse fulfillment unit for the
 * PICKED part of ONE order in ONE warehouse (Order 1:N Shipment; an order
 * from two warehouses splits into two shipments, matching 1 PickingTask = 1
 * Warehouse). Status is the warehouse ladder, never a logistics-track state.
 * Cross-module references (orders/warehouses) stay plain UUID columns - no
 * TypeORM relations across module boundaries.
 */
@Entity('shipments')
@Index('uq_shipments_no', ['shipmentNo'], { unique: true })
@Index('idx_shipments_order', ['orderId'])
@Index('idx_shipments_warehouse', ['warehouseId'])
@Index('idx_shipments_status', ['status'])
export class ShipmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, name: 'shipment_no' })
  shipmentNo!: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 30, default: 'READY_TO_PACK' })
  status!: ShipmentStatus;

  @Column({ type: 'varchar', length: 100, name: 'shipping_method', nullable: true })
  shippingMethod!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'tracking_number', nullable: true })
  trackingNumber!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'carrier_code', nullable: true })
  carrierCode!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'external_shipment_id', nullable: true })
  externalShipmentId!: string | null;

  @Column({ type: 'timestamptz', name: 'shipped_at', nullable: true })
  shippedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ShipmentItemEntity, (item) => item.shipment)
  items?: ShipmentItemEntity[];
}
