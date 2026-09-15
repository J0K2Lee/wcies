import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Platform-side return record (dual-axis T5, returns.md §2): a READ-ONLY
 * fact pulled from the platform (OZON rFBS returns). It never drives stock -
 * the physical ReturnBatch owns the write-back. Order linkage is best
 * effort: posting_number resolves store-scoped; a miss raises
 * RETURN_ORDER_NOT_FOUND instead of guessing (AGENTS.md §88).
 */
@Entity('platform_returns')
@Index('uq_platform_returns_store_return', ['storeId', 'platformReturnId'], { unique: true })
@Index('idx_platform_returns_order', ['orderId'])
@Index('idx_platform_returns_store_state', ['storeId', 'state'])
export class PlatformReturnEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  /** Platform return number (OZON return_number). */
  @Column({ type: 'varchar', length: 100, name: 'platform_return_id' })
  platformReturnId!: string;

  /** Platform order id the return refers to (OZON posting_number); nullable. */
  @Column({ type: 'varchar', length: 255, name: 'platform_order_id', nullable: true })
  platformOrderId!: string | null;

  /** Linked WCIES order, store-scoped resolution of platform_order_id. */
  @Column({ type: 'uuid', name: 'order_id', nullable: true })
  orderId!: string | null;

  /** Platform state string, stored verbatim as a fact. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  state!: string | null;

  /** Platform refund state (display-only fact, returns.md §4). */
  @Column({ type: 'varchar', length: 100, name: 'refund_state', nullable: true })
  refundState!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'platform_sku_id', nullable: true })
  platformSkuId!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'offer_id', nullable: true })
  offerId!: string | null;

  @Column({ type: 'varchar', length: 20 })
  quantity!: string;

  @Column({ type: 'timestamptz', name: 'platform_created_at', nullable: true })
  platformCreatedAt!: Date | null;

  @Column({ type: 'jsonb', name: 'raw_data', nullable: true })
  rawData!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
