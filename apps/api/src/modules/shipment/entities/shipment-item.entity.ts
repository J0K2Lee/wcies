import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ShipmentEntity } from './shipment.entity';

/**
 * Shipment ITEM (Sprint 4 task §13/§16): the snapshot of ONE PICKED order
 * line this shipment must send. Package completeness and the ship stock
 * consumption both validate against this quantity. order_item_id is UNIQUE
 * globally: a line belongs to at most one live shipment; the row is deleted
 * when an interception returns the line to stock (task §43).
 */
@Entity('shipment_items')
@Index('uq_shipment_items_shipment_order_item', ['shipmentId', 'orderItemId'], { unique: true })
@Index('uq_shipment_items_order_item', ['orderItemId'], { unique: true })
@Index('idx_shipment_items_shipment', ['shipmentId'])
@Index('idx_shipment_items_sku', ['skuId'])
export class ShipmentItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'shipment_id' })
  shipmentId!: string;

  @Column({ type: 'uuid', name: 'order_item_id' })
  orderItemId!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'uuid', name: 'reservation_id' })
  reservationId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3 })
  quantity!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => ShipmentEntity, (shipment) => shipment.items)
  @JoinColumn({ name: 'shipment_id' })
  shipment?: ShipmentEntity;
}
