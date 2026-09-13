import { Injectable } from '@nestjs/common';
import { StoreContext } from '@wcies/platform-contracts';
import { OzonClient } from './ozon.client';
import { mergeCategoryTrees, TreeMergeStats } from './ozon-category-tree.mapper';
import { parseOzonAuth } from './ozon.adapter';
import { PlatformCategoryNodeEntity } from './entities/platform-category-node.entity';
import { PlatformCategoryNodeRepository } from './repositories/platform-category-node.repository';

export interface CategoryTreeSyncResult {
  totalNodes: number;
  stats: TreeMergeStats;
}

/**
 * OZON description-category tree cache (Sprint 8.5 T3a).
 *
 * Pulls the tree twice (ZH_HANS + RU), merges bilingual names, and fully
 * replaces the platform's cached node set. Runs on the SyncJob ledger via
 * the sync module's CategoryTreeSyncService - this service owns only the
 * platform call + cache write.
 */
@Injectable()
export class OzonCategoryTreeService {
  constructor(
    private readonly client: OzonClient,
    private readonly nodeRepository: PlatformCategoryNodeRepository,
  ) {}

  async syncTree(context: StoreContext, platformId: string): Promise<CategoryTreeSyncResult> {
    const auth = parseOzonAuth(context.credential, context.storeId);
    const [zh, ru] = await Promise.all([
      this.client.descriptionCategoryTree(auth, context.storeId, 'ZH_HANS'),
      this.client.descriptionCategoryTree(auth, context.storeId, 'RU'),
    ]);
    const { nodes, stats } = mergeCategoryTrees(zh.result, ru.result);
    const totalNodes = await this.nodeRepository.replacePlatformNodes(platformId, nodes);
    return { totalNodes, stats };
  }

  /** Cached nodes for import planning (listing module's category import). */
  async listNodes(platformId: string): Promise<PlatformCategoryNodeEntity[]> {
    return this.nodeRepository.listByPlatform(platformId);
  }

  async countNodes(platformId: string): Promise<number> {
    return this.nodeRepository.countByPlatform(platformId);
  }
}
