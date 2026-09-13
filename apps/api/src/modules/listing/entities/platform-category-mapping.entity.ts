import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const CATEGORY_MAPPING_SOURCES = ['TREE_IMPORT', 'ONBOARD'] as const;
export type CategoryMappingSource = (typeof CATEGORY_MAPPING_SOURCES)[number];

/**
 * Platform category -> internal category mapping (Sprint 8.5 T3b/T3c).
 *
 * Keyed by the FULL composite external key (category_id + type_id): the T0
 * smoke test found 19 OZON types that live under several parent categories,
 * so matching by type_id alone is ambiguous. Resolution is always an exact
 * composite match - never a name-similarity guess.
 *
 * Lives in the listing module (same domain as platform_listing_skus): the
 * onboarding dialog reads/writes it next to the variant rows it maps.
 */
@Entity('platform_category_mappings')
@Index('uq_pcm_external_key', ['platformId', 'externalCategoryId', 'externalTypeId'], {
  unique: true,
})
@Index('idx_pcm_internal_category', ['internalCategoryId'])
export class PlatformCategoryMappingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'platform_id' })
  platformId!: string;

  @Column({ type: 'bigint', name: 'external_category_id' })
  externalCategoryId!: string;

  @Column({ type: 'bigint', name: 'external_type_id' })
  externalTypeId!: string;

  @Column({ type: 'uuid', name: 'internal_category_id' })
  internalCategoryId!: string;

  /** Provenance: bulk tree import vs. "remember this mapping" on onboard. */
  @Column({ type: 'varchar', length: 30, default: 'ONBOARD' })
  source!: string;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
