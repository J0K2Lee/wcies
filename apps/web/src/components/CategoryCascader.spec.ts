import { describe, expect, it } from 'vitest';
import {
  CATEGORY_SEARCH_LIMIT,
  categorySearchFilter,
  compareCategorySearch,
} from './CategoryCascader';
import { CategoryPickerNode } from './CategoryCascader';

/** 真实类目路径（截图里的那一条）。 */
const PATH: readonly CategoryPickerNode[] = [
  { nameZh: '住宅和花园', nameRu: 'Дом и сад' },
  { nameZh: '饮具及附属用品', nameRu: 'Питьевая посуда' },
  { nameZh: '水杯', nameRu: 'Стаканы' },
];

describe('categorySearchFilter（俄语只搜不显）', () => {
  it('matches the Chinese name of any level', () => {
    expect(categorySearchFilter('水杯', PATH)).toBe(true);
    expect(categorySearchFilter('饮具', PATH)).toBe(true);
  });

  it('matches the Russian name even though it is never rendered', () => {
    expect(categorySearchFilter('напитков', PATH)).toBe(false);
    expect(categorySearchFilter('стакан', PATH)).toBe(true);
    expect(categorySearchFilter('Дом', PATH)).toBe(true);
  });

  it('is case-insensitive and ignores surrounding spaces', () => {
    expect(categorySearchFilter('  ДОМ  ', PATH)).toBe(true);
  });

  it('returns false for an empty query or a miss', () => {
    expect(categorySearchFilter('   ', PATH)).toBe(false);
    expect(categorySearchFilter('不存在的类目', PATH)).toBe(false);
  });

  it('caps the dropdown at 20 results', () => {
    expect(CATEGORY_SEARCH_LIMIT).toBe(20);
  });
});

describe('compareCategorySearch（想选的那条排前面）', () => {
  const leaf = (nameZh: string, nameRu: string | null = null): CategoryPickerNode[] => [
    { nameZh: '住宅和花园', nameRu: 'Дом и сад' },
    { nameZh, nameRu },
  ];

  it('puts an exact leaf match before a prefix match and the rest', () => {
    const exact = leaf('水杯');
    const prefix = leaf('水杯架');
    const other = leaf('饮具', 'Питьевая посуда');
    const sorted = [other, prefix, exact].sort((a, b) => compareCategorySearch(a, b, '水杯'));
    expect(sorted[0]).toBe(exact);
    expect(sorted[1]).toBe(prefix);
    expect(sorted[2]).toBe(other);
  });

  it('ranks an exact Russian leaf match first too', () => {
    const exact = leaf('水杯', 'Стаканы');
    const other = leaf('饮具', 'Питьевая посуда');
    expect(compareCategorySearch(exact, other, 'стаканы')).toBeLessThan(0);
  });
});
