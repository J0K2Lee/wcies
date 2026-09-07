import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Product / SPU - the sellable concept; internal SKUs hang off it
 * (task §15). UUID is the immutable identity; product_code is the editable
 * business code (PRD000001). main_image_id logically references sku_images
 * (no DB FK: products -> sku_images -> skus -> products would be circular).
 */
@Entity('products')
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, name: 'product_code', unique: true })
  productCode!: string;

  @Column({ type: 'varchar', length: 500, name: 'name_zh' })
  nameZh!: string;

  @Column({ type: 'varchar', length: 500, name: 'name_ru', nullable: true })
  nameRu!: string | null;

  @Column({ type: 'uuid', name: 'category_id', nullable: true })
  categoryId!: string | null;

  @Column({ type: 'uuid', name: 'brand_id', nullable: true })
  brandId!: string | null;

  @Column({ type: 'uuid', name: 'main_image_id', nullable: true })
  mainImageId!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'DRAFT' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy!: string | null;
}

export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
