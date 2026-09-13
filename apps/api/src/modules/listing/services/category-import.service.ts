import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CatalogService } from '../../catalog/catalog.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { formatCategoryCode } from '../../../infrastructure/business-code/business-code.service';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { OzonCategoryTreeService } from '../../integration/ozon/ozon-category-tree.service';
import { PlatformCategoryMappingRepository } from '../repositories/platform-category-mapping.repository';
import { CategoryImportConflictsError, CategoryTreeNotSyncedError } from '../errors/listing-errors';

/** Structural view of a cached tree node (no entity import needed). */
export interface ImportTreeNode {
  id: string;
  nodeKind: string;
  externalCategoryId: string;
  externalTypeId: string | null;
  parentNodeExternalId: string | null;
  nameZh: string;
  nameRu: string | null;
  level: number;
  disabled: boolean;
}

export interface ImportPlanRow {
  /** Composite external key ('c:<id>' / 't:<cat>:<type>'). */
  key: string;
  kind: 'CATEGORY' | 'TYPE';
  externalCategoryId: string;
  externalTypeId: string | null;
  parentKey: string | null;
  nameZh: string;
  nameRu: string | null;
  /** Internal level: same as node level (verified 1:1 tree shape). */
  level: number;
}

export interface ImportPlanStats {
  totalNodes: number;
  skippedDisabled: number;
  /** Nodes under a disabled/missing ancestor (or deeper than level 3). */
  skippedOrphaned: number;
  duplicateCompositeKeys: number;
  toCreate: { level1: number; level2: number; level3: number };
}

export interface CategoryRename {
  name: string;
  renamedTo: string;
}

export interface CategoryImportConflict {
  name: string;
  level: number;
  reason: string;
}

export interface CategoryImportPreview {
  platformId: string;
  stats: ImportPlanStats;
  conflicts: CategoryImportConflict[];
  /** Same-parent name collisions, deterministically disambiguated (§89). */
  disambiguatedNames: CategoryRename[];
  disambiguatedCount: number;
  previewTopLevels: Array<{
    nameZh: string;
    nameRu: string | null;
    level2Count: number;
    level3Count: number;
  }>;
}

export interface CategoryImportResult {
  platformId: string;
  created: { level1: number; level2: number; level3: number };
  mappingCount: number;
}

interface ExistingCategoryRow {
  id: string;
  parentId: string | null;
  nameZh: string;
  nameRu: string | null;
  level: number;
}

/**
 * Sprint 8.5 T3b: one-click import of the cached platform tree into the
 * internal three-level category system.
 *
 * Collapse rule (planning §T3b.2): internal L1 = top category, L2 = the
 * type's direct parent category, L3 = the type itself. The live OZON tree
 * already matches that shape 1:1 (T0 smoke), but deeper intermediates would
 * be skipped and reported, not guessed.
 *
 * Dry-run never writes; execute runs ONE transaction (categories via the
 * catalog module's public bulk service + mapping rows) and refuses on any
 * conflict (AGENTS.md §89: dedupe first, error on ambiguity, never drop).
 */
@Injectable()
export class CategoryImportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly treeService: OzonCategoryTreeService,
    private readonly catalogService: CatalogService,
    private readonly businessCode: BusinessCodeService,
    private readonly mappingRepository: PlatformCategoryMappingRepository,
    private readonly operationLog: OperationLogService,
  ) {}

  async preview(platformId: string): Promise<CategoryImportPreview> {
    const nodes = await this.loadNodes(platformId);
    const { rows, stats } = buildImportPlan(nodes);
    const { rows: disambiguated, renames } = disambiguateSiblingNames(rows);
    const existing = await this.loadExistingCategories();
    const conflicts = findConflicts(disambiguated, existing);
    return {
      platformId,
      stats,
      conflicts,
      disambiguatedNames: renames.slice(0, 50),
      disambiguatedCount: renames.length,
      previewTopLevels: buildTopLevelPreview(disambiguated).slice(0, 10),
    };
  }

  async execute(platformId: string, operator: OperatorContext): Promise<CategoryImportResult> {
    const nodes = await this.loadNodes(platformId);
    const plan = buildImportPlan(nodes);
    const rows = plan.rows;
    if (rows.length === 0) {
      throw new CategoryTreeNotSyncedError(platformId);
    }
    // Real trees contain same-named types under one parent (57 such groups
    // on the 2026-09-14 pull); the internal model forbids same-parent
    // duplicates, so they are deterministically disambiguated (external id
    // suffix) and reported - never dropped, never silently merged.
    const { rows: disambiguated } = disambiguateSiblingNames(rows);
    const existing = await this.loadExistingCategories();
    const conflicts = findConflicts(disambiguated, existing);
    if (conflicts.length > 0) {
      throw new CategoryImportConflictsError(conflicts);
    }

    const created = { level1: 0, level2: 0, level3: 0 };
    let mappingCount = 0;
    const internalIdByKey = new Map<string, string>();
    await this.dataSource.transaction(async (manager) => {
      const { from } = await this.businessCode.nextRange('category', rows.length, manager);
      let allocated = 0;
      // Insert level by level: a parent's internal id only exists after its
      // own level is inserted, so links are resolved between levels.
      for (let level = 1; level <= 3; level += 1) {
        const levelRows = disambiguated.filter((row) => row.level === level);
        if (levelRows.length === 0) {
          continue;
        }
        const insertRows = levelRows.map((row, index) => ({
          key: row.key,
          level,
          parentId: row.parentKey === null ? null : (internalIdByKey.get(row.parentKey) ?? null),
          nameZh: row.nameZh,
          nameRu: row.nameRu,
          code: formatCategoryCode(from + allocated + index),
          sortOrder: allocated + index,
        }));
        allocated += levelRows.length;
        const saved = await this.catalogService.createCategoriesBulkInTx(
          manager,
          insertRows.map(({ key: _key, ...rest }) => rest),
        );
        saved.forEach((category, index) => {
          internalIdByKey.set(insertRows[index]?.key ?? '', category.id);
          if (category.level === 1) {
            created.level1 += 1;
          } else if (category.level === 2) {
            created.level2 += 1;
          } else {
            created.level3 += 1;
          }
        });
      }

      const mappingRows = rows
        .filter((row) => row.kind === 'TYPE')
        .map((row) => ({
          platformId,
          externalCategoryId: row.externalCategoryId,
          externalTypeId: row.externalTypeId ?? '0',
          internalCategoryId: internalIdByKey.get(row.key) ?? '',
          createdBy: operator.userId,
        }))
        .filter((row) => row.internalCategoryId !== '');
      mappingCount = await this.mappingRepository.bulkInsertInTx(manager, mappingRows);
    });

    await this.operationLog.record({
      entityType: 'CATEGORY',
      entityId: platformId,
      entityCode: `platform:${platformId}`,
      action: 'IMPORT_CREATE',
      changes: {
        level1: { from: null, to: created.level1 },
        level2: { from: null, to: created.level2 },
        level3: { from: null, to: created.level3 },
        mappings: { from: null, to: mappingCount },
        source: { from: null, to: 'PLATFORM_TREE_IMPORT' },
      },
      operator,
    });
    return { platformId, created, mappingCount };
  }

  private async loadNodes(platformId: string): Promise<ImportTreeNode[]> {
    const nodes = await this.treeService.listNodes(platformId);
    return nodes.map((node) => ({
      id: node.id,
      nodeKind: String(node.nodeKind),
      externalCategoryId: String(node.externalCategoryId),
      externalTypeId: node.externalTypeId === null ? null : String(node.externalTypeId),
      parentNodeExternalId:
        node.parentNodeExternalId === null ? null : String(node.parentNodeExternalId),
      nameZh: node.nameZh,
      nameRu: node.nameRu,
      level: node.level,
      disabled: node.disabled,
    }));
  }

  private async loadExistingCategories(): Promise<ExistingCategoryRow[]> {
    const tree = await this.catalogService.listCategoryTree();
    const flat: ExistingCategoryRow[] = [];
    const walk = (nodes: typeof tree, parentId: string | null): void => {
      for (const node of nodes) {
        flat.push({
          id: node.id,
          parentId,
          nameZh: node.nameZh,
          nameRu: node.nameRu,
          level: node.level,
        });
        walk(node.children, node.id);
      }
    };
    walk(tree, null);
    return flat;
  }
}

/**
 * Pure plan builder (unit-tested): disables, orphans, duplicate composite
 * keys and the 3-level collapse all happen here, before any write.
 */
export function buildImportPlan(nodes: readonly ImportTreeNode[]): {
  rows: ImportPlanRow[];
  stats: ImportPlanStats;
} {
  const stats: ImportPlanStats = {
    totalNodes: nodes.length,
    skippedDisabled: 0,
    skippedOrphaned: 0,
    duplicateCompositeKeys: 0,
    toCreate: { level1: 0, level2: 0, level3: 0 },
  };
  const keyOf = (node: ImportTreeNode): string | null => {
    if (node.nodeKind === 'TYPE') {
      return node.externalTypeId === null
        ? null
        : `t:${node.externalCategoryId}:${node.externalTypeId}`;
    }
    return `c:${node.externalCategoryId}`;
  };
  const parentKeyOf = (node: ImportTreeNode): string | null => {
    if (node.nodeKind === 'TYPE') {
      return `c:${node.externalCategoryId}`;
    }
    return node.parentNodeExternalId === null ? null : `c:${node.parentNodeExternalId}`;
  };

  const all = new Map<string, ImportTreeNode>();
  for (const node of nodes) {
    const key = keyOf(node);
    if (key !== null && !all.has(key)) {
      all.set(key, node);
    } else if (key !== null) {
      stats.duplicateCompositeKeys += 1;
    }
  }

  // A node is importable when it is enabled and its whole ancestor chain is
  // importable (disabled parents drop their subtree - reported, not guessed).
  const importable = new Map<string, ImportTreeNode>();
  const resolve = (key: string, seen: Set<string>): boolean => {
    if (importable.has(key)) {
      return true;
    }
    const node = all.get(key);
    if (node === undefined || node.disabled) {
      return false;
    }
    if (node.level > 3) {
      return false;
    }
    const parentKey = parentKeyOf(node);
    if (parentKey !== null) {
      if (seen.has(parentKey)) {
        return false;
      }
      seen.add(key);
      if (!resolve(parentKey, seen)) {
        return false;
      }
    }
    return true;
  };
  for (const [key, node] of all) {
    if (node.disabled) {
      stats.skippedDisabled += 1;
      continue;
    }
    if (!resolve(key, new Set())) {
      stats.skippedOrphaned += 1;
      continue;
    }
    importable.set(key, node);
  }

  const rows: ImportPlanRow[] = [];
  for (const [key, node] of importable) {
    const level = node.nodeKind === 'TYPE' ? 3 : node.level;
    rows.push({
      key,
      kind: node.nodeKind === 'TYPE' ? 'TYPE' : 'CATEGORY',
      externalCategoryId: node.externalCategoryId,
      externalTypeId: node.externalTypeId,
      parentKey: parentKeyOf(node),
      nameZh: node.nameZh,
      nameRu: node.nameRu,
      level,
    });
    if (level === 1) {
      stats.toCreate.level1 += 1;
    } else if (level === 2) {
      stats.toCreate.level2 += 1;
    } else {
      stats.toCreate.level3 += 1;
    }
  }
  // Level order (L1 first) so parents exist before children at insert time.
  rows.sort((a, b) => a.level - b.level);
  return { rows, stats };
}

/** Pure conflict detection (AGENTS.md §89): exact matches only, no guessing. */
export function findConflicts(
  rows: readonly ImportPlanRow[],
  existing: readonly ExistingCategoryRow[],
): CategoryImportConflict[] {
  const conflicts: CategoryImportConflict[] = [];
  const existingByRu = new Map<string, ExistingCategoryRow>();
  for (const category of existing) {
    if (category.nameRu !== null && category.nameRu !== '') {
      const normalized = category.nameRu.trim().toLowerCase();
      if (!existingByRu.has(normalized)) {
        existingByRu.set(normalized, category);
      }
    }
  }
  for (const row of rows) {
    if (row.nameRu !== null && row.nameRu !== '') {
      const hit = existingByRu.get(row.nameRu.trim().toLowerCase());
      if (hit !== undefined) {
        conflicts.push({
          name: row.nameZh,
          level: row.level,
          reason: `name_ru「${row.nameRu}」与现有分类「${hit.nameZh}」(CN ${hit.level}级) 精确重名`,
        });
      }
    }
  }
  return conflicts;
}

/**
 * Deterministic sibling-name disambiguation: the real OZON tree contains
 * same-named types under one parent (57 groups on the 2026-09-14 pull),
 * which the internal (parent_id, lower(name_zh)) uniqueness forbids. The
 * second and later duplicates get an external-id suffix - every row stays
 * in the import with a unique name, nothing is dropped or merged silently,
 * and the composite-key mapping is unaffected (it never used names).
 */
export function disambiguateSiblingNames(rows: readonly ImportPlanRow[]): {
  rows: ImportPlanRow[];
  renames: CategoryRename[];
} {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const siblingKey = `${row.parentKey ?? 'root'}:${row.nameZh.toLowerCase()}`;
    counts.set(siblingKey, (counts.get(siblingKey) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const renames: CategoryRename[] = [];
  const output = rows.map((row) => {
    const siblingKey = `${row.parentKey ?? 'root'}:${row.nameZh.toLowerCase()}`;
    const total = counts.get(siblingKey) ?? 1;
    if (total === 1) {
      return row;
    }
    const index = (seen.get(siblingKey) ?? 0) + 1;
    seen.set(siblingKey, index);
    if (index === 1) {
      return row;
    }
    const externalId = row.externalTypeId ?? row.externalCategoryId;
    const renamedTo = `${row.nameZh} (${externalId})`;
    renames.push({ name: row.nameZh, renamedTo });
    return { ...row, nameZh: renamedTo };
  });
  return { rows: output, renames };
}

function buildTopLevelPreview(
  rows: readonly ImportPlanRow[],
): CategoryImportPreview['previewTopLevels'] {
  const level1 = rows.filter((row) => row.level === 1);
  return level1.map((top) => {
    const key = top.key;
    const level2 = rows.filter((row) => row.level === 2 && row.parentKey === key);
    const level2Keys = new Set(level2.map((row) => row.key));
    const level3 = rows.filter(
      (row) => row.level === 3 && row.parentKey !== null && level2Keys.has(row.parentKey),
    );
    return {
      nameZh: top.nameZh,
      nameRu: top.nameRu,
      level2Count: level2.length,
      level3Count: level3.length,
    };
  });
}
