import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A platform product page/body (task §46). Unique per
 * (store_id, platform_product_id). One internal SKU may appear in MANY
 * listings - never add UNIQUE(sku_id, store_id) (task §48).
 */
@Entity('platform_listings')
@Index('uq_platform_listings_store_ppid', ['storeId', 'platformProductId'], { unique: true })
@Index('idx_platform_listings_platform', ['platformId'])
export class PlatformListingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'platform_id' })
  platformId!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @Column({ type: 'varchar', length: 255, name: 'platform_product_id' })
  platformProductId!: string;

  @Column({ type: 'text', nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  url!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'jsonb', name: 'raw_data', nullable: true })
  rawData!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

export const LISTING_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
