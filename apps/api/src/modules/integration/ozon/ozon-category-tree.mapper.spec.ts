import { describe, expect, it } from 'vitest';
import { mergeCategoryTrees } from './ozon-category-tree.mapper';
import { OzonCategoryTreeNode } from './types/api.types';

/**
 * Sprint 8.5 T3a: bilingual tree merge. The structural facts asserted here
 * are the 2026-09-14 T0 smoke findings (ozon.md §8): 3-level tree, TYPE
 * entries carry no description_category_id (category part = parent), and
 * ZH/RU key sets match.
 */

const zhTree: OzonCategoryTreeNode[] = [
  {
    description_category_id: 1,
    category_name: '儿童用品',
    children: [
      {
        description_category_id: 11,
        category_name: '积木玩具套装',
        children: [{ type_id: 92952, type_name: '积木' }],
      },
      { description_category_id: 12, category_name: '玩偶', children: [] },
    ],
  },
  {
    description_category_id: 2,
    category_name: '服装',
    disabled: true,
    children: [{ type_id: 100, type_name: 'T恤' }],
  },
];

const ruTree: OzonCategoryTreeNode[] = [
  {
    description_category_id: 1,
    category_name: 'Детские товары',
    children: [
      {
        description_category_id: 11,
        category_name: 'Конструктор',
        children: [{ type_id: 92952, type_name: 'Конструктор' }],
      },
      { description_category_id: 12, category_name: 'Куклы', children: [] },
    ],
  },
  {
    description_category_id: 2,
    category_name: 'Одежда',
    children: [{ type_id: 100, type_name: 'Футболка' }],
  },
];

describe('mergeCategoryTrees', () => {
  it('merges ZH names with RU names on identical composite keys', () => {
    const { nodes, stats } = mergeCategoryTrees(zhTree, ruTree);
    expect(stats.categoryCount).toBe(4);
    expect(stats.typeCount).toBe(2);

    const type = nodes.find((node) => node.kind === 'TYPE' && node.externalTypeId === '92952');
    expect(type).toBeDefined();
    expect(type?.nameZh).toBe('积木');
    expect(type?.nameRu).toBe('Конструктор');
    // TYPE rows carry the PARENT category id (they have none of their own).
    expect(type?.externalCategoryId).toBe('11');
    expect(type?.parentExternalId).toBe('11');
    expect(type?.level).toBe(3);
  });

  it('keeps category nodes with parent links and levels', () => {
    const { nodes } = mergeCategoryTrees(zhTree, ruTree);
    const level2 = nodes.find(
      (node) => node.kind === 'CATEGORY' && node.externalCategoryId === '11',
    );
    expect(level2?.parentExternalId).toBe('1');
    expect(level2?.level).toBe(2);
    const root = nodes.find((node) => node.kind === 'CATEGORY' && node.externalCategoryId === '1');
    expect(root?.parentExternalId).toBeNull();
    expect(root?.level).toBe(1);
  });

  it('propagates the disabled flag from either language pull', () => {
    const { nodes } = mergeCategoryTrees(zhTree, ruTree);
    const disabled = nodes.find((node) => node.externalCategoryId === '2');
    expect(disabled?.disabled).toBe(true);
    expect(nodes.find((node) => node.externalTypeId === '100')?.disabled).toBe(false);
  });

  it('falls back to the RU name when the ZH pull lacks a node, never drops it', () => {
    const zhOnlyRoots: OzonCategoryTreeNode[] = [
      {
        description_category_id: 1,
        category_name: '儿童用品',
        children: [],
      },
    ];
    const { nodes, stats } = mergeCategoryTrees(zhOnlyRoots, ruTree);
    expect(stats.zhFallbackCount).toBe(5);
    const type = nodes.find((node) => node.externalTypeId === '92952');
    expect(type?.nameZh).toBe('Конструктор');
    expect(type?.nameRu).toBe('Конструктор');
    // No node is silently dropped for a missing ZH name.
    expect(nodes).toHaveLength(6);
  });

  it('dedupes identical composite keys repeated within one pull', () => {
    const duplicated: OzonCategoryTreeNode[] = [
      {
        description_category_id: 1,
        category_name: 'A',
        children: [
          { type_id: 5, type_name: 'T' },
          { type_id: 5, type_name: 'T' },
        ],
      },
    ];
    const { nodes } = mergeCategoryTrees(duplicated, []);
    const types = nodes.filter((node) => node.kind === 'TYPE');
    expect(types).toHaveLength(1);
  });

  it('drops only nodes DEEPER than level 3 (defensive; real tree is exactly 3)', () => {
    const deep: OzonCategoryTreeNode[] = [
      {
        description_category_id: 1,
        category_name: 'A',
        children: [
          {
            description_category_id: 11,
            category_name: 'B',
            children: [
              {
                description_category_id: 111,
                category_name: 'C',
                children: [{ type_id: 7, type_name: 'T7' }],
              },
            ],
          },
        ],
      },
    ];
    const { nodes } = mergeCategoryTrees(deep, []);
    // The level-3 category itself is kept (childless); only the level-4 type
    // is dropped - it would exceed the internal 1..3 model.
    expect(nodes.some((node) => node.externalCategoryId === '111')).toBe(true);
    expect(nodes.some((node) => node.externalTypeId === '7')).toBe(false);
  });
});
