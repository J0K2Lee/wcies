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
import { ShipmentEntity } from './shipment.entity';
import { ShipmentItemStatus, VoidSourceType } from '../enums/shipment.constants';

/**
 * Shipment ITEM (Sprint 4 task §13/§16): the snapshot of ONE PICKED order
 * line this shipment must send. Package completeness and the ship stock
 * consumption both validate against this quantity.
 *
 * Lifecycle (Sprint 4 follow-up): rows are NEVER physically deleted. An
 * interception return VOIDS the row and keeps it as audit history with who /
 * when / why / which source voided it. ACTIVE means "still a valid component
 * of the shipment, not voided" - NOT "not shipped yet", so a SHIPPED shipment
 * legitimately keeps ACTIVE items.
 *
 * Uniqueness: at most one ACTIVE row per order_item_id (partial unique index,
 * see migration 20260910_010). VOIDED history rows do not block a future
 * re-fulfilment of the same order line.
 */
@Entity('shipment_items')
@Index('uq_shipment_items_order_item_active', ['orderItemId'], {
  unique: true,
  where: "status = 'ACTIVE'",
})
@Index('idx_shipment_items_shipment', ['shipmentId'])
@Index('idx_shipment_items_sku', ['skuId'])
@Index('idx_shipment_items_status', ['status'])
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

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: ShipmentItemStatus;

  @Column({ type: 'timestamptz', name: 'voided_at', nullable: true })
  voidedAt!: Date | null;

  /** Stable operator identity (users.id); null for system-triggered voids. */
  @Column({ type: 'uuid', name: 'voided_by', nullable: true })
  voidedBy!: string | null;

  /** Display name snapshot at void time (never the audit identity itself). */
  @Column({ type: 'varchar', length: 100, name: 'voided_by_name', nullable: true })
  voidedByName!: string | null;

  @Column({ type: 'text', name: 'void_reason', nullable: true })
  voidReason!: string | null;

  /** Polymorphic source type (no FK - validated by the Service layer). */
  @Column({ type: 'varchar', length: 40, name: 'void_source_type', nullable: true })
  voidSourceType!: VoidSourceType | null;

  /** Polymorphic source id, e.g. order_interceptions.id (no FK by design). */
  @Column({ type: 'uuid', name: 'void_source_id', nullable: true })
  voidSourceId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => ShipmentEntity, (shipment) => shipment.items)
  @JoinColumn({ name: 'shipment_id' })
  shipment?: ShipmentEntity;
}
