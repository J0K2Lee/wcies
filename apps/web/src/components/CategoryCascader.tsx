import { CascaderProps } from 'antd';
import { colors } from '../design-system';

/**
 * 三级分类选择器（2026-10-23 用户需求：快速建档 / SKU 建档共用同一套体验）。
 *
 * 问题：分类路径是「中文 (俄文) / 中文 (俄文) / 中文 (俄文)」，下拉宽度撑不下
 * 直接截断，同一父级下的兄弟看起来一模一样。
 *
 * 处理：
 * - **只显示中文**（俄文不再出现在任何可见文本里）；
 * - **俄语仍可搜**：`filter` 对每一级的 nameZh / nameRu 都做包含匹配；
 * - **搜索结果两行**：末级中文名 + 灰色中文面包屑，悬浮提示给完整路径（含俄文）；
 * - **相关度排序**：末级精确匹配 > 前缀匹配 > 其他，避免想选的那条被压在后面；
 * - 上限 20 条，避免一次刷出几十行。
 *
 * 选中后的输入框显示中文完整路径（`displayRender`），不再带俄文。
 */

/** 选项最少需要的字段（CategoryNode 的子集，两个弹窗的 option 都满足）。 */
export interface CategoryPickerNode {
  readonly nameZh?: string;
  readonly nameRu?: string | null;
}

export interface CategoryPickerOption extends CategoryPickerNode {
  value: string;
  label: string;
  disabled?: boolean;
  children?: CategoryPickerOption[];
}

/** 搜索结果上限（用户 2026-10-23 确认 20 条）。 */
export const CATEGORY_SEARCH_LIMIT = 20;

const normalize = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

/** 任意一级的中文名或俄文名命中即可（俄语只参与匹配，不显示）。 */
export function categorySearchFilter(input: string, path: readonly CategoryPickerNode[]): boolean {
  const query = normalize(input);
  if (query === '') {
    return false;
  }
  return path.some(
    (node) => normalize(node.nameZh).includes(query) || normalize(node.nameRu).includes(query),
  );
}

function leafRank(path: readonly CategoryPickerNode[], query: string): number {
  const leaf = path[path.length - 1];
  const names = [normalize(leaf?.nameZh), normalize(leaf?.nameRu)].filter((name) => name !== '');
  if (names.some((name) => name === query)) {
    return 0;
  }
  if (names.some((name) => name.startsWith(query))) {
    return 1;
  }
  return 2;
}

/** 相关度排序：末级精确 > 末级前缀 > 其他（其余保持平台顺序）。 */
export function compareCategorySearch(
  a: readonly CategoryPickerNode[],
  b: readonly CategoryPickerNode[],
  input: string,
): number {
  const query = normalize(input);
  return leafRank(a, query) - leafRank(b, query);
}

/** 搜索结果两行渲染：末级名（主）+ 中文面包屑（次）。 */
export function renderCategorySearchResult(
  _input: string,
  path: readonly CategoryPickerNode[],
): React.ReactNode {
  const leaf = path[path.length - 1];
  const breadcrumb = path
    .slice(0, -1)
    .map((node) => node.nameZh ?? '')
    .filter((name) => name !== '')
    .join(' / ');
  const fullPath = path.map((node) => [node.nameZh, node.nameRu].filter(Boolean).join(' '));
  return (
    <div
      title={fullPath.join(' / ')}
      style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35, padding: '2px 0' }}
    >
      <span style={{ fontWeight: 550 }}>{leaf?.nameZh ?? ''}</span>
      {breadcrumb !== '' && (
        <span style={{ fontSize: 12, color: colors.textTertiary }}>{breadcrumb}</span>
      )}
    </div>
  );
}

/**
 * 直接展开到 `<Cascader {...CATEGORY_CASCADER_PROPS} options={...} />`。
 *
 * 不做包装组件：antd 的 `CascaderAutoProps` 是「单选 / 多选」判别联合，包装后
 * 靠 spread 传参会把 `multiple` 推成 `true` 分支，类型对不上。给一组 props 既
 * 保持两个弹窗一致，又不碰判别联合。
 */
export const CATEGORY_CASCADER_PROPS: Pick<
  CascaderProps<CategoryPickerOption, 'value', false>,
  'allowClear' | 'showSearch' | 'displayRender'
> = {
  allowClear: true,
  showSearch: {
    filter: categorySearchFilter,
    render: renderCategorySearchResult,
    sort: compareCategorySearch,
    limit: CATEGORY_SEARCH_LIMIT,
  },
  displayRender: (labels) => labels.join(' / '),
};
