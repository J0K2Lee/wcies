import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Internal SKU - the unified identity for inventory / orders / purchase /
 * cost / SN / transfer (task §20/§21). Product 1:N SKU, never the reverse.
 *
 * volume_cm3 is ALWAYS recomputed by the backend from length x width x
 * height; clients cannot write it (task §23). moving_average_cost exists as
 * a reserved field and stays null until the purchase sprint (task §24).
 */
@Entity('skus')
@Index('idx_skus_product', ['productId'])
export class SkuEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'product_id' })
  productId!: string;

  @Column({ type: 'varchar', length: 100, name: 'sku_code', unique: true })
  skuCode!: string;

  @Column({ type: 'varchar', length: 500, name: 'name_zh' })
  nameZh!: string;

  @Column({ type: 'varchar', length: 500, name: 'name_ru', nullable: true })
  nameRu!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  model!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  color!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  size!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 4, name: 'weight_kg', nullable: true })
  weightKg!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 3, name: 'length_cm', nullable: true })
  lengthCm!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 3, name: 'width_cm', nullable: true })
  widthCm!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 3, name: 'height_cm', nullable: true })
  heightCm!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 3, name: 'volume_cm3', nullable: true })
  volumeCm3!: string | null;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 4,
    name: 'latest_purchase_price',
    nullable: true,
  })
  latestPurchasePrice!: string | null;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 4,
    name: 'moving_average_cost',
    nullable: true,
  })
  movingAverageCost!: string | null;

  @Column({ type: 'varchar', length: 10, name: 'cost_currency', default: 'CNY' })
  costCurrency!: string;

  @Column({ type: 'boolean', name: 'serial_tracking', default: false })
  serialTracking!: boolean;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

export const SKU_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE'] as const;
export type SkuStatus = (typeof SKU_STATUSES)[number];
