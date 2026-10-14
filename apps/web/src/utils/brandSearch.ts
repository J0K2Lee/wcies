/**
 * 品牌搜索文本（2026-10-14）：品牌有四个名称字段（一般 `name`、中文 `nameZh`、
 * 英文 `nameEn`、俄文 `nameRu`，决策 0006）——运营可能只知道其中任意一个，
 * 只拿一般名称做匹配会出现"明明有品牌却搜不到"。
 *
 * 前端品牌选择器一律 `showSearch` + 客户端过滤（品牌是小型主数据，一次取全），
 * 因此把四个名称与编码拼成一段**仅供搜索**的文本，配合
 * `optionFilterProp="searchText"` 使用：可见 label 保持简洁不变，搜索却能命中
 * 任意名称。后端 `GET /brands?keyword=` 采用同一口径（编码 + 四个名称 ILIKE），
 * 供品牌管理弹窗等服务端搜索场景使用——两边必须同步，否则同类"搜不到"复现。
 */

export interface BrandSearchable {
  code: string;
  name: string;
  nameZh?: string | null;
  nameEn?: string | null;
  nameRu?: string | null;
}

/** 编码 + 四个名称（自动去空去重），大小写不敏感（由 antd 过滤负责）。 */
export function brandSearchText(brand: BrandSearchable): string {
  return [brand.code, brand.name, brand.nameZh, brand.nameEn, brand.nameRu]
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .join(' ');
}
