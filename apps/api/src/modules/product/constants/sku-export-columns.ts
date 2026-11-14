import { SkuStockSummary } from '../../inventory/services/inventory-query.service';
import { SkuExportRow } from '../repositories/sku.repository';

/**
 * SKU 自定义列导出的**唯一列目录**（2026-11-04）。
 *
 * 后端用它在请求里校验列 key（未知列直接 422），并用它生成表头/取值；
 * 前端通过 `GET /skus/exports/columns` 拿到同一份目录渲染勾选弹窗 ——
 * 加列只改这一个文件，前端不需要硬编码列清单。
 *
 * 两条口径（用户确认）：
 * - 勾选了 `listing: true` 的列 → 一行一个平台映射（同一 SKU 多行，SKU 列重复）；
 * - 只勾 SKU 列 → 每个 SKU 只出一行（不展开，避免无意义重复）。
 */
export const SKU_EXPORT_GROUPS = [
  { key: 'BASIC', label: '基础' },
  { key: 'SPEC', label: '规格' },
  { key: 'COST', label: '成本 / 采购' },
  { key: 'BARCODE', label: '条码' },
  { key: 'LISTING', label: '平台映射' },
  { key: 'STOCK', label: '库存' },
] as const;

export type SkuExportGroupKey = (typeof SKU_EXPORT_GROUPS)[number]['key'];

/** Excel 单元格格式；`text` 用于编码/条码，避免被 Excel 转成科学计数法。 */
export type SkuExportCellFormat = 'text' | 'int' | 'numeric3' | 'money' | 'boolean' | 'datetime';

export interface SkuExportContext {
  row: SkuExportRow;
  /** 该 SKU 的库存汇总；NULL = 没有库存账面行（≠ 0，AGENTS.md §20）。 */
  stock: SkuStockSummary | null;
}

export type SkuExportCell = string | number | boolean | Date | null;

export interface SkuExportColumnDefinition {
  key: string;
  label: string;
  group: SkuExportGroupKey;
  /** 来自平台映射：勾选后按「一行一 listing」展开。 */
  listing: boolean;
  defaultSelected: boolean;
  format: SkuExportCellFormat;
  width: number;
  read: (context: SkuExportContext) => SkuExportCell;
}

/** SKU 状态的导出文案（与界面一致）。 */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  ACTIVE: '启用',
  INACTIVE: '停用',
};

/** numeric(…, …,n) 字符串 → Excel 数值；空值保持空单元格。 */
function numericOf(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function yesNo(value: boolean): string {
  return value ? '是' : '否';
}

export const SKU_EXPORT_COLUMNS: readonly SkuExportColumnDefinition[] = [
  // ---- 基础 ----
  {
    key: 'skuCode',
    label: 'SKU编码',
    group: 'BASIC',
    listing: false,
    defaultSelected: true,
    format: 'text',
    width: 16,
    read: ({ row }) => row.skuCode,
  },
  {
    key: 'nameZh',
    label: '中文名称',
    group: 'BASIC',
    listing: false,
    defaultSelected: true,
    format: 'text',
    width: 32,
    read: ({ row }) => row.nameZh,
  },
  {
    key: 'nameRu',
    label: '俄文名称',
    group: 'BASIC',
    listing: false,
    defaultSelected: false,
    format: 'text',
    width: 32,
    read: ({ row }) => row.nameRu,
  },
  {
    key: 'brand',
    label: '品牌',
    group: 'BASIC',
    listing: false,
    defaultSelected: true,
    format: 'text',
    width: 14,
    read: ({ row }) => row.brandName,
  },
  {
    key: 'category',
    label: '分类',
    group: 'BASIC',
    listing: false,
    defaultSelected: true,
    format: 'text',
    width: 26,
    read: ({ row }) => row.categoryName,
  },
  {
    key: 'status',
    label: '状态',
    group: 'BASIC',
    listing: false,
    defaultSelected: true,
    format: 'text',
    width: 8,
    read: ({ row }) => STATUS_LABELS[row.status] ?? row.status,
  },
  {
    key: 'remark',
    label: '备注',
    group: 'BASIC',
    listing: false,
    defaultSelected: false,
    format: 'text',
    width: 24,
    read: ({ row }) => row.remark,
  },
  {
    key: 'createdAt',
    label: '创建时间',
    group: 'BASIC',
    listing: false,
    defaultSelected: false,
    format: 'datetime',
    width: 18,
    read: ({ row }) => row.createdAt,
  },
  {
    key: 'updatedAt',
    label: '更新时间',
    group: 'BASIC',
    listing: false,
    defaultSelected: false,
    format: 'datetime',
    width: 18,
    read: ({ row }) => row.updatedAt,
  },

  // ---- 规格 ----
  {
    key: 'model',
    label: '型号',
    group: 'SPEC',
    listing: false,
    defaultSelected: true,
    format: 'text',
    width: 16,
    read: ({ row }) => row.model,
  },
  {
    key: 'color',
    label: '颜色',
    group: 'SPEC',
    listing: false,
    defaultSelected: false,
    format: 'text',
    width: 10,
    read: ({ row }) => row.color,
  },
  {
    key: 'size',
    label: '尺码',
    group: 'SPEC',
    listing: false,
    defaultSelected: false,
    format: 'text',
    width: 10,
    read: ({ row }) => row.size,
  },
  {
    key: 'weightG',
    label: '重量(g)',
    group: 'SPEC',
    listing: false,
    defaultSelected: false,
    format: 'numeric3',
    width: 12,
    read: ({ row }) => numericOf(row.weightG),
  },
  {
    key: 'lengthMm',
    label: '长(mm)',
    group: 'SPEC',
    listing: false,
    defaultSelected: false,
    format: 'int',
    width: 10,
    read: ({ row }) => row.lengthMm,
  },
  {
    key: 'widthMm',
    label: '宽(mm)',
    group: 'SPEC',
    listing: false,
    defaultSelected: false,
    format: 'int',
    width: 10,
    read: ({ row }) => row.widthMm,
  },
  {
    key: 'heightMm',
    label: '高(mm)',
    group: 'SPEC',
    listing: false,
    defaultSelected: false,
    format: 'int',
    width: 10,
    read: ({ row }) => row.heightMm,
  },
  {
    key: 'volumeMm3',
    label: '体积(mm³)',
    group: 'SPEC',
    listing: false,
    defaultSelected: false,
    format: 'int',
    width: 14,
    read: ({ row }) => numericOf(row.volumeMm3),
  },
  {
    key: 'serialTracking',
    label: '序列号管理',
    group: 'SPEC',
    listing: false,
    defaultSelected: false,
    format: 'boolean',
    width: 12,
    read: ({ row }) => yesNo(row.serialTracking),
  },

  // ---- 成本 / 采购 ----
  {
    key: 'latestPurchasePrice',
    label: '最近采购价',
    group: 'COST',
    listing: false,
    defaultSelected: true,
    format: 'money',
    width: 14,
    read: ({ row }) => numericOf(row.latestPurchasePrice),
  },
  {
    key: 'movingAverageCost',
    label: '移动平均成本',
    group: 'COST',
    listing: false,
    defaultSelected: false,
    format: 'money',
    width: 14,
    read: ({ row }) => numericOf(row.movingAverageCost),
  },
  {
    key: 'costCurrency',
    label: '币种',
    group: 'COST',
    listing: false,
    defaultSelected: false,
    format: 'text',
    width: 8,
    read: ({ row }) => row.costCurrency,
  },
  {
    key: 'purchaseUrl',
    label: '采购链接',
    group: 'COST',
    listing: false,
    defaultSelected: false,
    format: 'text',
    width: 42,
    read: ({ row }) => row.purchaseUrl,
  },

  // ---- 条码 ----
  {
    key: 'primaryBarcode',
    label: '主条码',
    group: 'BARCODE',
    listing: false,
    defaultSelected: true,
    format: 'text',
    width: 18,
    read: ({ row }) => row.primaryBarcode,
  },

  // ---- 平台映射（一行一 listing） ----
  {
    key: 'platform',
    label: '平台',
    group: 'LISTING',
    listing: true,
    defaultSelected: true,
    format: 'text',
    width: 10,
    read: ({ row }) => row.platformCode,
  },
  {
    key: 'storeCode',
    label: '店铺编码',
    group: 'LISTING',
    listing: true,
    defaultSelected: true,
    format: 'text',
    width: 12,
    read: ({ row }) => row.storeCode,
  },
  {
    key: 'storeName',
    label: '店铺名称',
    group: 'LISTING',
    listing: true,
    defaultSelected: false,
    format: 'text',
    width: 18,
    read: ({ row }) => row.storeName,
  },
  {
    key: 'platformProductId',
    label: '平台商品ID',
    group: 'LISTING',
    listing: true,
    defaultSelected: false,
    format: 'text',
    width: 20,
    read: ({ row }) => row.platformProductId,
  },
  {
    key: 'platformSkuId',
    label: '平台SKU ID',
    group: 'LISTING',
    listing: true,
    defaultSelected: true,
    format: 'text',
    width: 20,
    read: ({ row }) => row.platformSkuId,
  },
  {
    key: 'sellerSku',
    label: '卖家SKU',
    group: 'LISTING',
    listing: true,
    defaultSelected: false,
    format: 'text',
    width: 18,
    read: ({ row }) => row.sellerSku,
  },
  {
    key: 'offerId',
    label: 'Offer ID',
    group: 'LISTING',
    listing: true,
    defaultSelected: true,
    format: 'text',
    width: 20,
    read: ({ row }) => row.offerId,
  },
  {
    key: 'listingTitle',
    label: '链接标题',
    group: 'LISTING',
    listing: true,
    defaultSelected: false,
    format: 'text',
    width: 32,
    read: ({ row }) => row.listingTitle,
  },
  {
    key: 'listingUrl',
    label: '链接地址',
    group: 'LISTING',
    listing: true,
    defaultSelected: false,
    format: 'text',
    width: 42,
    read: ({ row }) => row.listingUrl,
  },
  {
    key: 'listingStatus',
    label: '链接状态',
    group: 'LISTING',
    listing: true,
    defaultSelected: false,
    format: 'text',
    width: 10,
    read: ({ row }) => row.listingStatus,
  },

  // ---- 库存（跨仓合计；无账面行 → 空单元格） ----
  {
    key: 'onHandQty',
    label: '在库',
    group: 'STOCK',
    listing: false,
    defaultSelected: false,
    format: 'numeric3',
    width: 10,
    read: ({ stock }) => (stock === null ? null : numericOf(stock.onHandQty)),
  },
  {
    key: 'reservedQty',
    label: '占用',
    group: 'STOCK',
    listing: false,
    defaultSelected: false,
    format: 'numeric3',
    width: 10,
    read: ({ stock }) => (stock === null ? null : numericOf(stock.reservedQty)),
  },
  {
    key: 'pickedQty',
    label: '已拣',
    group: 'STOCK',
    listing: false,
    defaultSelected: false,
    format: 'numeric3',
    width: 10,
    read: ({ stock }) => (stock === null ? null : numericOf(stock.pickedQty)),
  },
  {
    key: 'safetyQty',
    label: '安全库存',
    group: 'STOCK',
    listing: false,
    defaultSelected: false,
    format: 'numeric3',
    width: 10,
    read: ({ stock }) => (stock === null ? null : numericOf(stock.safetyQty)),
  },
  {
    key: 'availableQty',
    label: '可售',
    group: 'STOCK',
    listing: false,
    defaultSelected: false,
    format: 'numeric3',
    width: 10,
    read: ({ stock }) => (stock === null ? null : numericOf(stock.availableQty)),
  },
];

export const SKU_EXPORT_COLUMN_KEYS: ReadonlySet<string> = new Set(
  SKU_EXPORT_COLUMNS.map((column) => column.key),
);

/** 按列 key 取定义（调用方已保证都在白名单内）。 */
export const SKU_EXPORT_COLUMN_BY_KEY: ReadonlyMap<string, SkuExportColumnDefinition> = new Map(
  SKU_EXPORT_COLUMNS.map((column) => [column.key, column]),
);

export const SKU_EXPORT_DEFAULT_COLUMNS: readonly string[] = SKU_EXPORT_COLUMNS.filter(
  (column) => column.defaultSelected,
).map((column) => column.key);

/** 勾选的列里是否有平台映射列（决定是否按「一行一 listing」展开）。 */
export function hasListingColumns(columnKeys: readonly string[]): boolean {
  return columnKeys.some((key) => SKU_EXPORT_COLUMN_BY_KEY.get(key)?.listing === true);
}
