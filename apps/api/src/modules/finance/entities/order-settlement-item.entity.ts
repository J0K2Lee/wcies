import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { OrderSettlementEntity } from './order-settlement.entity';

/** Frozen settlement line snapshot (finance.md §5.2). */
@Entity('order_settlement_items')
@Index('idx_order_settlement_items_settlement', ['settlementId'])
@Index('idx_order_settlement_items_sku', ['skuId'])
export class OrderSettlementItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'settlement_id' })
  settlementId!: string;

  @Column({ type: 'uuid', name: 'order_item_id' })
  orderItemId!: string;

  @Column({ type: 'uuid', name: 'sku_id', nullable: true })
  skuId!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 3 })
  quantity!: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'unit_price', nullable: true })
  unitPrice!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  revenue!: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'unit_cost', nullable: true })
  unitCost!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  cost!: string;

  @ManyToOne(() => OrderSettlementEntity, (settlement) => settlement.items)
  @JoinColumn({ name: 'settlement_id' })
  settlement?: OrderSettlementEntity;
}
