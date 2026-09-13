import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformCategoryNodeEntity } from '../entities/platform-category-node.entity';
import { MergedCategoryNode } from '../ozon-category-tree.mapper';

/**
 * Data access for the platform category tree cache (Sprint 8.5 T3a).
 * Full-rewrite semantics: a sync replaces the platform's whole node set
 * (the ~8k-row tree is tiny; mappings reference internal categories, not
 * nodes, so nothing else holds FKs here).
 */
@Injectable()
export class PlatformCategoryNodeRepository {
  constructor(
    @InjectRepository(PlatformCategoryNodeEntity)
    private readonly repository: Repository<PlatformCategoryNodeEntity>,
  ) {}

  async replacePlatformNodes(
    platformId: string,
    nodes: readonly MergedCategoryNode[],
  ): Promise<number> {
    return this.repository.manager.transaction(async (manager) => {
      await manager.delete(PlatformCategoryNodeEntity, { platformId });
      const fetchedAt = new Date();
      const chunkSize = 500;
      for (let start = 0; start < nodes.length; start += chunkSize) {
        const chunk = nodes.slice(start, start + chunkSize).map((node) => ({
          platformId,
          nodeKind: node.kind,
          externalCategoryId: node.externalCategoryId,
          externalTypeId: node.externalTypeId,
          parentNodeExternalId: node.parentExternalId,
          nameZh: node.nameZh,
          nameRu: node.nameRu,
          level: node.level,
          disabled: node.disabled,
          fetchedAt,
        }));
        await manager.insert(PlatformCategoryNodeEntity, chunk);
      }
      return nodes.length;
    });
  }

  async listByPlatform(platformId: string): Promise<PlatformCategoryNodeEntity[]> {
    return this.repository.find({
      where: { platformId },
      order: { level: 'ASC', id: 'ASC' },
    });
  }

  async countByPlatform(platformId: string): Promise<number> {
    return this.repository.count({ where: { platformId } });
  }
}
