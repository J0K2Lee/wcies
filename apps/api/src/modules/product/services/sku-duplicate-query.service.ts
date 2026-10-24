import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { compareSkuNames, skuNameNarrowToken } from '@wcies/shared';

/** 供「映射 / 建档」弹窗展示的 SKU 摘要（含使用热度，用于推荐保留哪个档案）。 */
export interface SkuDuplicateCandidate {
  skuId: string;
  skuCode: string;
  nameZh: string;
  brandName: string | null;
  categoryName: string | null;
  orderLineCount: number;
  onHandQty: string;
}

export interface SkuNameMatch extends SkuDuplicateCandidate {
  /** SAME/CONTAINED = 名称签名一致；SIMILAR + 同型号 = 另一个配色/版本。 */
  relation: 'SAME' | 'CONTAINED' | 'SIMILAR';
  conflicts: string[];
  similarity: number;
}

interface CandidateRow {
  id: string;
  sku_code: string;
  name_zh: string;
  brand_name: string | null;
  category_name: string | null;
  order_line_count: string | number;
  on_hand_qty: string;
}

const DISPLAY_SQL = `
  SELECT s.id,
         s.sku_code,
         s.name_zh,
         b.name AS brand_name,
         cat.name_zh AS category_name,
         (SELECT COUNT(*) FROM order_items i WHERE i.sku_id = s.id) AS order_line_count,
         COALESCE((SELECT SUM(ib.on_hand_qty) FROM inventory_balances ib WHERE ib.sku_id = s.id), 0)::text AS on_hand_qty
    FROM skus s
    LEFT JOIN brands b ON b.id = s.brand_id
    LEFT JOIN categories cat ON cat.id = s.category_id
`;

function toCandidate(row: CandidateRow): SkuDuplicateCandidate {
  return {
    skuId: row.id,
    skuCode: row.sku_code,
    nameZh: row.name_zh,
    brandName: row.brand_name,
    categoryName: row.category_name,
    orderLineCount: Number(row.order_line_count),
    onHandQty: row.on_hand_qty,
  };
}

/**
 * SKU 档案重复的**名称侧**查询（2026-10-24）。
 *
 * 只读、不落库：给定「将要创建的名称 + 品牌」，找出名称签名相同或同型号的
 * 现有档案，交给调用方与平台标识证据合并后分成 SAME_FACT / SIMILAR_VARIANT。
 *
 * 平台变体证据（`platform_listing_skus`）属于 listing 模块，不在这里查——
 * 模块边界（AGENTS §9：不跨模块读对方内部表）由调用方组合。
 */
@Injectable()
export class SkuDuplicateQueryService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** 名称候选：先按最长词元 LIKE 窄化，再用共享规则精算。 */
  async listByNameMatch(input: {
    name: string;
    brandId: string | null;
    limit?: number;
  }): Promise<SkuNameMatch[]> {
    const narrow = skuNameNarrowToken(input.name);
    if (narrow === null) {
      return [];
    }
    const brandName = await this.brandNameOf(input.brandId);
    const rows = await this.dataSource.query<CandidateRow[]>(
      `${DISPLAY_SQL}
        WHERE s.status = 'ACTIVE'
          AND s.name_zh ILIKE '%' || $1 || '%'
        LIMIT 200`,
      [narrow],
    );

    const matches: SkuNameMatch[] = [];
    for (const row of rows) {
      const brand = toCandidate(row);
      // 品牌不同 = 不同事实（同名不同品牌在快消/配件里很常见）
      if (
        brandName !== null &&
        brandName.trim() !== '' &&
        brand.brandName !== null &&
        brand.brandName !== brandName
      ) {
        continue;
      }
      const comparison = compareSkuNames(
        { name: input.name, brandName },
        { name: brand.nameZh, brandName: brand.brandName },
      );
      if (comparison.relation === 'UNRELATED') {
        continue;
      }
      if (comparison.relation === 'SAME' || comparison.relation === 'CONTAINED') {
        if (comparison.conflicts.length > 0) {
          continue;
        }
        matches.push({
          ...brand,
          relation: comparison.relation,
          conflicts: [],
          similarity: comparison.similarity,
        });
        continue;
      }
      // SIMILAR：只有「同型号不同配色/版本」才值得提示，纯相似不要
      if (comparison.sameModelDifferentVariant) {
        matches.push({
          ...brand,
          relation: 'SIMILAR',
          conflicts: comparison.conflicts,
          similarity: comparison.similarity,
        });
      }
    }
    matches.sort(
      (a, b) =>
        Number(b.relation === 'SAME') - Number(a.relation === 'SAME') ||
        b.orderLineCount - a.orderLineCount,
    );
    return matches.slice(0, input.limit ?? 5);
  }

  private async brandNameOf(brandId: string | null): Promise<string | null> {
    if (brandId === null) {
      return null;
    }
    const rows = await this.dataSource.query<Array<{ name: string }>>(
      `SELECT name FROM brands WHERE id = $1::uuid`,
      [brandId],
    );
    return rows[0]?.name ?? null;
  }

  /** 按 id 取展示信息（平台标识证据命中后用来补 SKU 编码/热度）。 */
  async getDisplayByIds(ids: readonly string[]): Promise<Map<string, SkuDuplicateCandidate>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.dataSource.query<CandidateRow[]>(
      `${DISPLAY_SQL} WHERE s.id = ANY($1::uuid[])`,
      [[...ids]],
    );
    return new Map(rows.map((row) => [row.id, toCandidate(row)]));
  }
}
