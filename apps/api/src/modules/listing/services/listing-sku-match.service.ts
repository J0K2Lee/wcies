import { Injectable } from '@nestjs/common';
import { SkuDuplicateQueryService } from '../../product/services/sku-duplicate-query.service';
import { ListingRepository } from '../repositories/listing.repository';
import { ListingNotFoundError, ListingSkuMappingNotFoundError } from '../errors/listing-errors';
import { SkuMatchCandidateDto, SkuMatchCandidatesDto } from '../dto/listing.dto';

/**
 * 重复档案候选（2026-10-24 用户指示）：在「映射 / 建档」之前告诉运营
 * 「这个平台变体/这个名称，可能已经有档案了」。
 *
 * 分档只看证据类型，不看相似度数字：
 * - SAME_VARIANT：同店铺里这个平台变体已经挂在某个 SKU 上（再建就是分裂库存）；
 * - SAME_FACT：跨店铺同一平台标识 + 名称不冲突，或名称签名一致 —— 极可能同一实物；
 * - SIMILAR_VARIANT：同型号的另一个配色/版本 —— 通常应该建新档案，只提示不预选。
 *
 * 模块边界：平台标识证据来自本模块（listing），名称证据通过 product 的公开
 * 服务取得（AGENTS §9），两边在这里合并。
 */
export type SkuMatchLevel = 'SAME_VARIANT' | 'SAME_FACT' | 'SIMILAR_VARIANT';

const LEVEL_RANK: Record<SkuMatchLevel, number> = {
  SAME_VARIANT: 3,
  SAME_FACT: 2,
  SIMILAR_VARIANT: 1,
};

@Injectable()
export class ListingSkuMatchService {
  constructor(
    private readonly repository: ListingRepository,
    private readonly duplicateQuery: SkuDuplicateQueryService,
  ) {}

  async findCandidates(
    listingId: string,
    mappingId: string,
    input: { name?: string | null; brandId?: string | null },
  ): Promise<SkuMatchCandidatesDto> {
    const listing = await this.repository.findListingById(listingId);
    if (listing === null) {
      throw new ListingNotFoundError(listingId);
    }
    const mapping = await this.repository.findMappingById(mappingId);
    if (mapping === null || mapping.listingId !== listingId) {
      throw new ListingSkuMappingNotFoundError(mappingId);
    }

    const hits = new Map<string, { level: SkuMatchLevel; evidence: Set<string> }>();
    const merge = (skuId: string, level: SkuMatchLevel, evidence: string): void => {
      const current = hits.get(skuId);
      if (current === undefined) {
        hits.set(skuId, { level, evidence: new Set([evidence]) });
        return;
      }
      current.evidence.add(evidence);
      if (LEVEL_RANK[level] > LEVEL_RANK[current.level]) {
        current.level = level;
      }
    };

    // 1) 平台标识证据（同店铺 / 跨店铺）
    const bindings = await this.repository.findSkuBindingsByIdentifiers({
      storeId: listing.storeId,
      platformId: listing.platformId,
      platformSkuId: mapping.platformSkuId,
      offerId: mapping.offerId,
      sellerSku: mapping.sellerSku,
      excludeMappingId: mapping.id,
    });
    for (const binding of bindings) {
      merge(
        binding.skuId,
        binding.sameStore ? 'SAME_VARIANT' : 'SAME_FACT',
        binding.sameStore
          ? `本店铺这个平台变体已映射到该档案（${binding.storeCode}）`
          : `同一平台标识已在 ${binding.storeCode} 映射到该档案`,
      );
    }

    // 2) 名称证据（只有建档时才有名称可比较）
    const name = input.name?.trim() ?? '';
    if (name !== '') {
      const nameMatches = await this.duplicateQuery.listByNameMatch({
        name,
        brandId: input.brandId ?? null,
        limit: 5,
      });
      for (const match of nameMatches) {
        if (match.relation === 'SIMILAR') {
          merge(
            match.skuId,
            'SIMILAR_VARIANT',
            `同型号的另一个变体：${match.conflicts.join('、')}`,
          );
        } else {
          merge(
            match.skuId,
            'SAME_FACT',
            match.relation === 'SAME' ? '名称签名完全一致' : '名称签名包含关系',
          );
        }
      }
    }

    // 3) 补展示信息并排序（同一 SKU 只出现一次）
    const display = await this.duplicateQuery.getDisplayByIds([...hits.keys()]);
    const candidates: SkuMatchCandidateDto[] = [];
    for (const [skuId, hit] of hits) {
      const info = display.get(skuId);
      if (info === undefined) {
        continue;
      }
      candidates.push({
        ...info,
        level: hit.level,
        evidence: [...hit.evidence],
      });
    }
    candidates.sort(
      (a, b) =>
        LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
        b.orderLineCount - a.orderLineCount ||
        a.skuCode.localeCompare(b.skuCode),
    );
    const recommended = candidates.find((candidate) => candidate.level !== 'SIMILAR_VARIANT');

    return { candidates: candidates.slice(0, 5), recommendedSkuId: recommended?.skuId ?? null };
  }
}
