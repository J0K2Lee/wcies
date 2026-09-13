import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const CATEGORY_NODE_KINDS = ['CATEGORY', 'TYPE'] as const;
export type CategoryNodeKind = (typeof CATEGORY_NODE_KINDS)[number];

/**
 * Bilingual cache of the platform description-category tree (Sprint 8.5 T3a).
 *
 * Platform-generic by design (platform_id), OZON-only for now. Structure is a
 * verified T0 fact (2026-09-14): the real OZON tree is exactly 3 levels -
 * L1/L2 CATEGORY nodes plus L3 TYPE entries; TYPE nodes do NOT carry their
 * own description_category_id, so a TYPE row stores the PARENT category id
 * in external_category_id and its own id in external_type_id. The composite
 * external key (external_category_id, external_type_id) therefore lives on
 * every row and matches what platform listings carry in raw_data.
 */
@Entity('platform_category_nodes')
@Index('idx_pcn_platform_level', ['platformId', 'level'])
@Index('idx_pcn_parent', ['parentNodeExternalId'])
export class PlatformCategoryNodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'platform_id' })
  platformId!: string;

  @Column({ type: 'varchar', length: 20, name: 'node_kind' })
  nodeKind!: string;

  /** Own id for CATEGORY rows; parent category id for TYPE rows. */
  @Column({ type: 'bigint', name: 'external_category_id' })
  externalCategoryId!: string;

  /** Present only on TYPE rows (TypeORM reads bigint columns as strings). */
  @Column({ type: 'bigint', name: 'external_type_id', nullable: true })
  externalTypeId!: string | null;

  /**
   * Denormalized parent external key (instead of a uuid FK across sync
   * generations): the tree is fully rewritten per sync, so a stable external
   * reference keeps upserts order-free and parentless-safe.
   */
  @Column({ type: 'bigint', name: 'parent_node_external_id', nullable: true })
  parentNodeExternalId!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'name_zh' })
  nameZh!: string;

  @Column({ type: 'varchar', length: 500, name: 'name_ru', nullable: true })
  nameRu!: string | null;

  /** 1..3, mirrors the internal three-level model (decision 0005). */
  @Column({ type: 'smallint' })
  level!: number;

  @Column({ type: 'boolean', default: false })
  disabled!: boolean;

  @Column({ type: 'timestamptz', name: 'fetched_at' })
  fetchedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
