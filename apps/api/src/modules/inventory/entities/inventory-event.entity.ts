import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { InventoryEventType, InventoryReferenceType } from '../enums/inventory.constants';

/**
 * Inventory EVENT - parent of the transaction ledger (task §18, adopted
 * Event + Lines model). One business action = one event = one idempotency
 * key; moveBin writes ONE event with two transaction lines (Bin A -N,
 * Bin B +N) so the pair is auditable as a unit.
 */
@Entity('inventory_events')
@Index('uq_inventory_events_no', ['eventNo'], { unique: true })
@Index('uq_inventory_events_idem', ['idempotencyKey'], { unique: true })
export class InventoryEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, name: 'event_no' })
  eventNo!: string;

  @Column({ type: 'varchar', length: 40, name: 'event_type' })
  eventType!: InventoryEventType;

  @Column({ type: 'varchar', length: 30, name: 'reference_type' })
  referenceType!: InventoryReferenceType;

  @Column({ type: 'uuid', name: 'reference_id' })
  referenceId!: string;

  @Column({ type: 'varchar', length: 200, name: 'idempotency_key' })
  idempotencyKey!: string;

  @Column({ type: 'uuid', name: 'operator_id', nullable: true })
  operatorId!: string | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
