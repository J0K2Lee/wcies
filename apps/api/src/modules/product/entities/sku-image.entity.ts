import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * SKU image metadata; the binary lives in object storage under object_key
 * (task §33). At most one primary per SKU via partial unique index
 * uq_sku_images_one_primary. Reads go through signed URLs (private bucket).
 */
@Entity('sku_images')
@Index('idx_sku_images_sku', ['skuId'])
export class SkuImageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'text', name: 'object_key' })
  objectKey!: string;

  @Column({ type: 'varchar', length: 100, name: 'mime_type' })
  mimeType!: string;

  @Column({ type: 'bigint', name: 'file_size' })
  fileSize!: string;

  @Column({ type: 'integer', nullable: true })
  width!: number | null;

  @Column({ type: 'integer', nullable: true })
  height!: number | null;

  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  sortOrder!: number;

  @Column({ type: 'boolean', name: 'is_primary', default: false })
  isPrimary!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}

/** Allowed upload mime types; anything else is FILE_INVALID_TYPE (task §85). */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
