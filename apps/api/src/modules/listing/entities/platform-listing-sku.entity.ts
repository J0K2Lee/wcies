import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Platform SKU variant mapped to an internal SKU (task §47).
 *
 * One listing may hold many variants (black/blue/white -> different SKUs)
 * and one internal SKU may appear in many listings across stores.
 * platform identifiers are NOT globally unique - only plain query indexes,
 * uniqueness will be tightened per platform once real APIs connect
 * (task §50).
 */
@Entity('platform_listing_skus')
@Index('idx_pls_listing', ['listingId'])
@Index('idx_pls_sku', ['skuId'])
@Index('idx_pls_platform_sku_id', ['platformSkuId'])
@Index('idx_pls_offer_id', ['offerId'])
@Index('idx_pls_seller_sku', ['sellerSku'])
export class PlatformListingSkuEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'listing_id' })
  listingId!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'varchar', length: 255, name: 'platform_sku_id', nullable: true })
  platformSkuId!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'seller_sku', nullable: true })
  sellerSku!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'offer_id', nullable: true })
  offerId!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'jsonb', name: 'raw_data', nullable: true })
  rawData!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
