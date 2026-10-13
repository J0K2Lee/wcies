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
 * Units (2026-09-09 convention change): weight in g, dimensions in integer mm.
 * volume_mm3 is ALWAYS recomputed by the backend from length x width x height;
 * clients cannot write it (task §23). moving_average_cost exists as a reserved
 * field and stays null until the purchase sprint (task §24).
 *
 * 2026-10-13 V1 改造（任务 T1，决策 D5）：category_id / brand_id 成为 SKU
 * 自身字段（从原属 Product 单射继承一份，之后可独立修改）；product_id 仍
 * 在（数据库层已置空），阶段二删 products 表后一并移除。
 */
@Entity('skus')
@Index('idx_skus_product', ['productId'])
@Index('idx_skus_category', ['categoryId'])
@Index('idx_skus_brand', ['brandId'])
export class SkuEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'product_id' })
  productId!: string;

  @Column({ type: 'varchar', length: 100, name: 'sku_code', unique: true })
  skuCode!: string;

  /** V1 改造（任务 T1）：分类/品牌是 SKU 字段；可空，无 relation（与 products 旧列风格一致）。 */
  @Column({ type: 'uuid', name: 'category_id', nullable: true })
  categoryId!: string | null;

  @Column({ type: 'uuid', name: 'brand_id', nullable: true })
  brandId!: string | null;

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

  @Column({ type: 'numeric', precision: 12, scale: 3, name: 'weight_g', nullable: true })
  weightG!: string | null;

  @Column({ type: 'integer', name: 'length_mm', nullable: true })
  lengthMm!: number | null;

  @Column({ type: 'integer', name: 'width_mm', nullable: true })
  widthMm!: number | null;

  @Column({ type: 'integer', name: 'height_mm', nullable: true })
  heightMm!: number | null;

  @Column({ type: 'bigint', name: 'volume_mm3', nullable: true })
  volumeMm3!: string | null;

  @Column({ type: 'varchar', length: 1000, name: 'purchase_url', nullable: true })
  purchaseUrl!: string | null;

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
