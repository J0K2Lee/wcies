import { OzonCategoryTreeNode } from './types/api.types';

/**
 * OZON description-category tree -> flat bilingual node rows (Sprint 8.5
 * T3a). Pure functions - no HTTP, no repositories.
 *
 * Verified structure facts (T0 smoke, 2026-09-14):
 * - the tree is exactly 3 levels: L1/L2 categories + L3 TYPE entries;
 * - TYPE entries carry type_id/type_name but NO description_category_id -
 *   the composite external key's category part is the PARENT category;
 * - 19 type ids appear under several parents, so the composite key is the
 *   only unambiguous identity;
 * - ZH_HANS and RU pulls have identical key sets (merge is 1:1 on names).
 */

export interface MergedCategoryNode {
  kind: 'CATEGORY' | 'TYPE';
  /** Own id (CATEGORY) or parent category id (TYPE). */
  externalCategoryId: string;
  /** TYPE rows only. */
  externalTypeId: string | null;
  /** Parent CATEGORY id (null for level-1 nodes). */
  parentExternalId: string | null;
  nameZh: string;
  nameRu: string | null;
  level: number;
  disabled: boolean;
}

export interface TreeMergeStats {
  categoryCount: number;
  typeCount: number;
  /** Nodes whose ZH name was missing and fell back to the RU name. */
  zhFallbackCount: number;
  /** Keys present in only one language pull (kept with the available name). */
  singleLanguageCount: number;
}

interface FlatEntry {
  key: string;
  kind: 'CATEGORY' | 'TYPE';
  externalCategoryId: string;
  externalTypeId: string | null;
  parentExternalId: string | null;
  level: number;
}

/** Flattens one language pull into keyed entries carrying the given name. */
function flatten(
  roots: readonly OzonCategoryTreeNode[],
  pickName: (node: OzonCategoryTreeNode) => string | null,
): { entries: Map<string, FlatEntry>; names: Map<string, string>; disabled: Map<string, boolean> } {
  const entries = new Map<string, FlatEntry>();
  const names = new Map<string, string>();
  const disabled = new Map<string, boolean>();
  const walk = (
    nodes: readonly OzonCategoryTreeNode[],
    parentCategoryId: string | null,
    level: number,
  ): void => {
    for (const node of nodes) {
      if (node.type_id !== undefined && node.type_id !== null) {
        const categoryId =
          node.description_category_id !== undefined && node.description_category_id !== null
            ? String(node.description_category_id)
            : (parentCategoryId ?? '');
        const key = `t:${categoryId}:${node.type_id}`;
        if (!entries.has(key)) {
          entries.set(key, {
            key,
            kind: 'TYPE',
            externalCategoryId: categoryId,
            externalTypeId: String(node.type_id),
            parentExternalId: parentCategoryId,
            level,
          });
        }
        const name = pickName(node);
        if (name !== null && !names.has(key)) {
          names.set(key, name);
        }
        continue;
      }
      if (node.description_category_id === undefined || node.description_category_id === null) {
        continue;
      }
      const id = String(node.description_category_id);
      const key = `c:${id}`;
      if (!entries.has(key)) {
        entries.set(key, {
          key,
          kind: 'CATEGORY',
          externalCategoryId: id,
          externalTypeId: null,
          parentExternalId: parentCategoryId,
          level,
        });
      }
      const name = pickName(node);
      if (name !== null && !names.has(key)) {
        names.set(key, name);
      }
      if (node.disabled === true) {
        disabled.set(key, true);
      }
      if (Array.isArray(node.children)) {
        walk(node.children, id, level + 1);
      }
    }
  };
  walk(roots, null, 1);
  return { entries, names, disabled };
}

/**
 * Merges the ZH_HANS and RU pulls into deduped bilingual node rows keyed by
 * the composite external identity. Nodes deeper than level 3 are skipped
 * (none exist today, but the skip keeps the internal 1..3 model safe).
 */
export function mergeCategoryTrees(
  zhRoots: readonly OzonCategoryTreeNode[],
  ruRoots: readonly OzonCategoryTreeNode[],
): { nodes: MergedCategoryNode[]; stats: TreeMergeStats } {
  const zh = flatten(zhRoots, (node) =>
    node.type_name !== undefined ? (node.type_name ?? null) : (node.category_name ?? null),
  );
  const ru = flatten(ruRoots, (node) =>
    node.type_name !== undefined ? (node.type_name ?? null) : (node.category_name ?? null),
  );

  const nodes: MergedCategoryNode[] = [];
  const stats: TreeMergeStats = {
    categoryCount: 0,
    typeCount: 0,
    zhFallbackCount: 0,
    singleLanguageCount: 0,
  };
  const seen = new Set<string>();
  for (const source of [zh, ru]) {
    for (const [key, entry] of source.entries) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (entry.level > 3) {
        continue;
      }
      const nameZhRaw = zh.names.get(key) ?? null;
      const nameRu = ru.names.get(key) ?? null;
      const onlyOneLanguage = (zh.names.has(key) ? 1 : 0) + (ru.names.has(key) ? 1 : 0) === 1;
      if (onlyOneLanguage) {
        stats.singleLanguageCount += 1;
      }
      // name_zh is NOT NULL downstream: fall back to the RU name when the ZH
      // pull did not carry this node (never drop a node for a missing name).
      const nameZh = nameZhRaw ?? nameRu;
      if (nameZh === null) {
        continue;
      }
      if (nameZhRaw === null && nameRu !== null) {
        stats.zhFallbackCount += 1;
      }
      nodes.push({
        kind: entry.kind,
        externalCategoryId: entry.externalCategoryId,
        externalTypeId: entry.externalTypeId,
        parentExternalId: entry.parentExternalId,
        nameZh,
        nameRu,
        level: entry.level,
        disabled: zh.disabled.get(key) === true || ru.disabled.get(key) === true,
      });
      if (entry.kind === 'CATEGORY') {
        stats.categoryCount += 1;
      } else {
        stats.typeCount += 1;
      }
    }
  }
  return { nodes, stats };
}
