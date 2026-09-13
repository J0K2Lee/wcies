import { describe, expect, it } from 'vitest';
import {
  buildImportPlan,
  disambiguateSiblingNames,
  findConflicts,
  ImportTreeNode,
} from './category-import.service';

/**
 * Sprint 8.5 T3b: import plan computation + conflict detection (pure
 * functions). The collapse rule, disabled/orphan skips and AGENTS.md §89
 * (dedupe, error on ambiguity, never silently drop) are asserted here.
 */

function node(overrides: Partial<ImportTreeNode>): ImportTreeNode {
  return {
    id: 'n1',
    nodeKind: 'CATEGORY',
    externalCategoryId: '1',
    externalTypeId: null,
    parentNodeExternalId: null,
    nameZh: '儿童用品',
    nameRu: 'Детские товары',
    level: 1,
    disabled: false,
    ...overrides,
  };
}

const sampleNodes: ImportTreeNode[] = [
  node({
    id: 'n1',
    externalCategoryId: '1',
    level: 1,
    nameZh: '儿童用品',
    nameRu: 'Детские товары',
  }),
  node({
    id: 'n2',
    externalCategoryId: '11',
    parentNodeExternalId: '1',
    level: 2,
    nameZh: '积木玩具套装',
    nameRu: 'Конструктор',
  }),
  node({
    id: 'n3',
    nodeKind: 'TYPE',
    externalCategoryId: '11',
    externalTypeId: '92952',
    parentNodeExternalId: '11',
    level: 3,
    nameZh: '积木',
    nameRu: 'Конструктор TYPE',
  }),
];

describe('buildImportPlan', () => {
  it('maps the 3-level tree 1:1 (L1/L2 categories + type as L3)', () => {
    const { rows, stats } = buildImportPlan(sampleNodes);
    expect(stats.toCreate).toEqual({ level1: 1, level2: 1, level3: 1 });
    const typeRow = rows.find((row) => row.kind === 'TYPE');
    expect(typeRow?.level).toBe(3);
    expect(typeRow?.parentKey).toBe('c:11');
    expect(typeRow?.externalTypeId).toBe('92952');
    // Level order: parents precede children.
    expect(rows.map((row) => row.level)).toEqual(
      [...rows.map((row) => row.level)].sort((a, b) => a - b),
    );
  });

  it('skips disabled nodes AND their subtree (reported, not guessed)', () => {
    // Root 1 disabled, its L2 child 11 orphaned; independent root 99 healthy.
    const mixed: ImportTreeNode[] = [
      node({ id: 'a', externalCategoryId: '1', disabled: true, level: 1, nameZh: '禁用根' }),
      node({
        id: 'b',
        externalCategoryId: '11',
        parentNodeExternalId: '1',
        level: 2,
        nameZh: '孤儿二级',
      }),
      node({ id: 'c', externalCategoryId: '99', level: 1, nameZh: '正常根' }),
    ];
    const { rows, stats } = buildImportPlan(mixed);
    expect(stats.skippedDisabled).toBe(1);
    expect(stats.skippedOrphaned).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.nameZh).toBe('正常根');
  });

  it('dedupes duplicate composite keys (first wins)', () => {
    const duplicated: ImportTreeNode[] = [
      ...sampleNodes,
      node({
        id: 'n3-dup',
        nodeKind: 'TYPE',
        externalCategoryId: '11',
        externalTypeId: '92952',
        level: 3,
        nameZh: '积木(重复)',
      }),
    ];
    const { rows, stats } = buildImportPlan(duplicated);
    expect(rows.filter((row) => row.kind === 'TYPE')).toHaveLength(1);
    expect(stats.duplicateCompositeKeys).toBe(1);
  });
});

describe('findConflicts', () => {
  const plan = buildImportPlan(sampleNodes).rows;

  it('reports exact name_ru matches against existing categories', () => {
    const conflicts = findConflicts(plan, [
      {
        id: 'existing-1',
        parentId: null,
        nameZh: '内部已有',
        nameRu: 'Детские товары',
        level: 1,
      },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.name).toBe('儿童用品');
    expect(conflicts[0]?.reason).toContain('name_ru');
  });

  it('disambiguates same-parent name_zh duplicates with an external-id suffix (no drop)', () => {
    const rows = [
      ...plan,
      { ...plan[0]!, key: 'c:777', externalCategoryId: '777', nameZh: '儿童用品', nameRu: '其他' },
    ];
    const { rows: disambiguated, renames } = disambiguateSiblingNames(rows);
    expect(renames).toHaveLength(1);
    expect(renames[0]?.name).toBe('儿童用品');
    expect(renames[0]?.renamedTo).toBe('儿童用品 (777)');
    // First occurrence keeps its name; the duplicate is suffixed - and the
    // conflict check passes afterwards (nothing blocks the import).
    expect(findConflicts(disambiguated, [])).toHaveLength(0);
    expect(disambiguated.filter((row) => row.nameZh.startsWith('儿童用品'))).toHaveLength(2);
  });

  it('returns empty when nothing collides', () => {
    expect(findConflicts(plan, [])).toHaveLength(0);
  });
});
