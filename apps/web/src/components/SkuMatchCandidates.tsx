import { useMemo } from 'react';
import { useApiQuery, useDebouncedValue } from '../api/hooks';
import { colors, StatusBadge, StatusTone } from '../design-system';

/**
 * 重复档案候选面板（2026-10-24 用户指示）。
 *
 * 用途：在「SKU 映射」与「快速建档」这两个**创建/绑定之前**的流程里，把
 * 可能已经存在的档案直接摆出来。它不是审计工具——只回答一个问题：
 * 「这次操作会不会和已有档案指向同一件货？」
 *
 * 分档由后端给出（`SAME_VARIANT` / `SAME_FACT` / `SIMILAR_VARIANT`），前端只
 * 负责预选与文案，不理解规则；同型号不同配色只会提示「通常应建新档案」，
 * 不会被预选，避免把颜色变体错并。
 */
export type SkuMatchLevel = 'SAME_VARIANT' | 'SAME_FACT' | 'SIMILAR_VARIANT';

export interface SkuMatchCandidate {
  skuId: string;
  skuCode: string;
  nameZh: string;
  brandName: string | null;
  categoryName: string | null;
  orderLineCount: number;
  onHandQty: string;
  level: SkuMatchLevel;
  evidence: string[];
}

export interface SkuMatchCandidatesPayload {
  candidates: SkuMatchCandidate[];
  recommendedSkuId: string | null;
}

const LEVEL_META: Record<SkuMatchLevel, { tone: StatusTone; label: string; hint: string }> = {
  SAME_VARIANT: {
    tone: 'danger',
    label: '该变体已挂到此档案',
    hint: '这个平台变体在本店铺已经映射到这个 SKU；再映射一次或新建档案会让库存分裂',
  },
  SAME_FACT: {
    tone: 'warning',
    label: '极可能同一实物',
    hint: '名称签名或平台标识指向同一件货；优先复用它，否则会产生重复档案',
  },
  SIMILAR_VARIANT: {
    tone: 'neutral',
    label: '同型号另一变体',
    hint: '同型号但配色/版本不同，通常是另一个档案，不应合并',
  },
};

/** 拉取候选（映射流程不传名称；建档流程传将要使用的名称 + 品牌）。 */
export function useSkuMatchCandidates(input: {
  listingId: string | null;
  mappingId: string | null;
  name?: string | null;
  brandId?: string | null;
  enabled?: boolean;
}) {
  const debouncedName = useDebouncedValue(input.name ?? '', 400);
  const query = {
    ...(debouncedName.trim() === '' ? {} : { name: debouncedName.trim() }),
    ...(input.brandId === null || input.brandId === undefined || input.brandId === ''
      ? {}
      : { brandId: input.brandId }),
  };
  return useApiQuery<{ data: SkuMatchCandidatesPayload }>(
    '/api/v1/listings/{listingId}/skus/{id}/match-candidates',
    query,
    [
      'sku-match-candidates',
      input.listingId,
      input.mappingId,
      input.brandId ?? 'NO_BRAND',
      debouncedName.trim(),
    ],
    { listingId: input.listingId ?? '', id: input.mappingId ?? '' },
    (input.enabled ?? true) && input.listingId !== null && input.mappingId !== null,
  );
}

export function SkuMatchCandidatesPanel({
  listingId,
  mappingId,
  name = null,
  brandId = null,
  enabled = true,
  selectedSkuId = null,
  onPick,
  title = '已有档案（优先复用）',
}: {
  listingId: string | null;
  mappingId: string | null;
  name?: string | null;
  brandId?: string | null;
  enabled?: boolean;
  selectedSkuId?: string | null;
  onPick?: (candidate: SkuMatchCandidate) => void;
  title?: string;
}) {
  const query = useSkuMatchCandidates({ listingId, mappingId, name, brandId, enabled });
  const candidates = useMemo(() => query.data?.data.candidates ?? [], [query.data]);

  if (!enabled || listingId === null || mappingId === null) {
    return null;
  }
  if (query.isLoading) {
    return (
      <div style={{ fontSize: 12, color: colors.textTertiary, marginBottom: 8 }}>检查已有档案…</div>
    );
  }
  if (candidates.length === 0) {
    return null;
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12.5, color: colors.textSecondary, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {candidates.map((candidate) => {
          const meta = LEVEL_META[candidate.level];
          const selected = selectedSkuId === candidate.skuId;
          return (
            <div
              key={candidate.skuId}
              role={onPick === undefined ? undefined : 'button'}
              onClick={
                onPick === undefined
                  ? undefined
                  : (event) => {
                      event.stopPropagation();
                      onPick(candidate);
                    }
              }
              style={{
                border: `1px solid ${selected ? colors.infoBorder : colors.border}`,
                background: selected ? colors.infoBg : colors.container,
                borderRadius: 6,
                padding: '8px 10px',
                cursor: onPick === undefined ? 'default' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <StatusBadge tone={meta.tone} label={meta.label} hint={meta.hint} showDot={false} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{candidate.skuCode}</span>
                <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                  {candidate.nameZh}
                </span>
                {selected && (
                  <span style={{ fontSize: 12, color: colors.primary }}>已选为映射目标</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: colors.textTertiary }}>
                {candidate.evidence.join('；')}
              </div>
              <div style={{ fontSize: 12, color: colors.textTertiary }}>
                {candidate.brandName ?? '无品牌'} · {candidate.categoryName ?? '无分类'} · 订单行{' '}
                {candidate.orderLineCount} · 在库 {Number(candidate.onHandQty)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
