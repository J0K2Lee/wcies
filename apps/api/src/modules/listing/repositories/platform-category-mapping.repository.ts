import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { PlatformCategoryMappingEntity } from '../entities/platform-category-mapping.entity';

/**
 * Platform -> internal category mapping data access (Sprint 8.5 T3b/T3c).
 * Resolution is ALWAYS an exact composite-key match; no fuzzy fallback.
 */
@Injectable()
export class PlatformCategoryMappingRepository {
  constructor(
    @InjectRepository(PlatformCategoryMappingEntity)
    private readonly repository: Repository<PlatformCategoryMappingEntity>,
  ) {}

  /**
   * Batch composite-key lookup for the onboarding dialog ("which internal
   * category does this OZON (category_id, type_id) already map to?").
   */
  async findByKeys(
    platformId: string,
    keys: ReadonlyArray<{ externalCategoryId: string; externalTypeId: string }>,
  ): Promise<PlatformCategoryMappingEntity[]> {
    if (keys.length === 0) {
      return [];
    }
    return this.repository.find({
      where: keys.map((key) => ({
        platformId,
        externalCategoryId: key.externalCategoryId,
        externalTypeId: key.externalTypeId,
      })),
    });
  }

  async findByKey(
    platformId: string,
    externalCategoryId: string,
    externalTypeId: string,
  ): Promise<PlatformCategoryMappingEntity | null> {
    const rows = await this.findByKeys(platformId, [{ externalCategoryId, externalTypeId }]);
    return rows[0] ?? null;
  }

  async listByInternalCategoryIds(
    internalCategoryIds: readonly string[],
  ): Promise<PlatformCategoryMappingEntity[]> {
    if (internalCategoryIds.length === 0) {
      return [];
    }
    return this.repository.find({
      where: { internalCategoryId: In([...internalCategoryIds]) },
    });
  }

  async listByPlatform(platformId: string): Promise<PlatformCategoryMappingEntity[]> {
    return this.repository.find({ where: { platformId } });
  }

  async countByPlatform(platformId: string): Promise<number> {
    return this.repository.count({ where: { platformId } });
  }

  /**
   * "Remember this mapping" write on the CALLER's transaction (Sprint 8.5
   * T3c): ON CONFLICT DO NOTHING - an existing mapping (earlier onboard or
   * tree import) is never overwritten by a later one.
   */
  async insertIgnoreInTx(
    manager: EntityManager,
    input: {
      platformId: string;
      externalCategoryId: string;
      externalTypeId: string;
      internalCategoryId: string;
      source: 'TREE_IMPORT' | 'ONBOARD';
      createdBy: string | null;
    },
  ): Promise<boolean> {
    const result = await manager.query<Array<{ id: string }>>(
      `INSERT INTO platform_category_mappings
         (platform_id, external_category_id, external_type_id, internal_category_id, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (platform_id, external_category_id, external_type_id) DO NOTHING
       RETURNING id`,
      [
        input.platformId,
        input.externalCategoryId,
        input.externalTypeId,
        input.internalCategoryId,
        input.source,
        input.createdBy,
      ],
    );
    return result.length === 1;
  }

  /** Bulk insert for the tree import (same tx as the category creates). */
  async bulkInsertInTx(
    manager: EntityManager,
    rows: ReadonlyArray<{
      platformId: string;
      externalCategoryId: string;
      externalTypeId: string;
      internalCategoryId: string;
      createdBy: string | null;
    }>,
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    for (let start = 0; start < rows.length; start += 500) {
      const chunk = rows.slice(start, start + 500);
      await manager.query(
        `INSERT INTO platform_category_mappings
           (platform_id, external_category_id, external_type_id, internal_category_id, source, created_by)
         SELECT * FROM unnest(
             $1::uuid[],
             $2::bigint[],
             $3::bigint[],
             $4::uuid[],
             $5::varchar[],
             $6::uuid[]
           )
         ON CONFLICT (platform_id, external_category_id, external_type_id) DO NOTHING`,
        [
          chunk.map((row) => row.platformId),
          chunk.map((row) => row.externalCategoryId),
          chunk.map((row) => row.externalTypeId),
          chunk.map((row) => row.internalCategoryId),
          chunk.map(() => 'TREE_IMPORT'),
          chunk.map((row) => row.createdBy),
        ],
      );
    }
    return rows.length;
  }
}
