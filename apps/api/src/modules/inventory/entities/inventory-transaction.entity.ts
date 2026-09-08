import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { InventoryEventEntity } from './inventory-event.entity';
import { InventoryTransactionType, InventoryReferenceType } from '../enums/inventory.constants';

/**
 * Inventory TRANSACTION - the immutable ledger line (task §16).
 * quantity_* track On Hand; reserved_* / picked_* are filled only when the
 * action moves them. Belongs to exactly one inventory event; the per-line
 * idempotency key is `<event key>#<line no>`. Audit data - no DELETE
 * (task §77).
 */
@Entity('inventory_transactions')
@Index('uq_inventory_transactions_no', ['transactionNo'], { unique: true })
@Index('uq_inventory_transactions_idem', ['idempotencyKey'], { unique: true })
@Index('idx_inventory_transactions_sku_created', ['skuId', 'createdAt'])
@Index('idx_inventory_transactions_wh_created', ['warehouseId', 'createdAt'])
@Index('idx_inventory_transactions_reference', ['referenceType', 'referenceId'])
@Index('idx_inventory_transactions_event', ['eventId'])
export class InventoryTransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 40, name: 'transaction_no' })
  transactionNo!: string;

  @Column({ type: 'uuid', name: 'event_id' })
  eventId!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'uuid', name: 'bin_id' })
  binId!: string;

  @Column({ type: 'varchar', length: 40, name: 'transaction_type' })
  transactionType!: InventoryTransactionType;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'quantity_before' })
  quantityBefore!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'quantity_change' })
  quantityChange!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'quantity_after' })
  quantityAfter!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'reserved_before', nullable: true })
  reservedBefore!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'reserved_change', nullable: true })
  reservedChange!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'reserved_after', nullable: true })
  reservedAfter!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'picked_before', nullable: true })
  pickedBefore!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'picked_change', nullable: true })
  pickedChange!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'picked_after', nullable: true })
  pickedAfter!: string | null;

  @Column({ type: 'varchar', length: 30, name: 'reference_type' })
  referenceType!: InventoryReferenceType;

  @Column({ type: 'uuid', name: 'reference_id' })
  referenceId!: string;

  @Column({ type: 'varchar', length: 220, name: 'idempotency_key' })
  idempotencyKey!: string;

  @Column({ type: 'uuid', name: 'operator_id', nullable: true })
  operatorId!: string | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => InventoryEventEntity)
  @JoinColumn({ name: 'event_id' })
  event?: InventoryEventEntity;
}
