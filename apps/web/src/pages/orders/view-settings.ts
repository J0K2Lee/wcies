/**
 * 订单页「视图设置」的持久化与默认值（2026-10-17 由 OrdersPage 拆出）。
 *
 * 这些是纯模块级常量与读写函数，没有任何组件耦合 —— 从 3,900 行的页面文件里
 * 搬出来既减小了主文件，也让「本地序列化格式」有了唯一的落点：改列默认值时
 * 只需要看这一个文件，不用在巨型组件里翻找。
 */
export interface ColumnSetting {
  key: string;
  visible: boolean;
}

export interface OrdersViewSettings {
  /** 默认展开所有订单行。 */
  defaultExpandAll: boolean;
  /** 每页显示的订单行数。 */
  pageSize: number;
  /** 展开行主图缩略图边长（px，方形不裁剪）。 */
  thumbnailSize: number;
  /** 默认排序（2026-10-14 用户指示：在视图设置中配置；排序按钮只切会话态）。 */
  defaultSortBy: 'orderedAt' | 'pickedAt' | 'shippedAt' | 'skuCode' | 'shipmentDeadline';
  defaultSortOrder: 'asc' | 'desc';
  /** 主表列（数组顺序即显示顺序）。 */
  mainColumns: ColumnSetting[];
  /** 展开行列（数组顺序即显示顺序）。 */
  expandedColumns: ColumnSetting[];
}

// 视图设置版本：v3（2026-10-17）——「店铺」与「履约方式」合并成一列
// 「店铺·履约」，平台运单号改为默认收起（列表里该字段大多为空，却整列占宽），
// 主表因此不再需要横向滚动。升版让已有用户拿到新默认值，旧版偏好自然废弃
// （v2 里存的是「店铺」「履约方式」两个已不存在的列 key）。
export const VIEW_SETTINGS_KEY = 'wcies.orders.view.v3';

export const DEFAULT_VIEW_SETTINGS: OrdersViewSettings = {
  defaultExpandAll: false,
  pageSize: 20,
  // 主图边长 72（2026-10-17）：展开明细右侧是「SKU/名称 + Offer ID + 数量价格」三行，
  // 实测高 73px —— 48px 的图会在下方留 25px 空白。72 与三行基本等高，视觉上对齐。
  thumbnailSize: 72,
  defaultSortBy: 'orderedAt',
  defaultSortOrder: 'desc',
  mainColumns: [
    { key: 'platformOrderId', visible: true },
    { key: 'items', visible: true },
    // SKU 列（2026-10-14）：展示该单最小 SKU 编码，是「SKU 排序」的可视依据。
    { key: 'sku', visible: true },
    { key: 'erpStatus', visible: true },
    // 物流（2026-10-19 用户指示）：订单级平台物流阶段 待揽收/运输中/已签收，
    // 并在其前显示「已打印」胶囊。ERP 状态仍保持「已发货」（两轴分离）。
    { key: 'logistics', visible: true },
    // 店铺与履约方式合并（2026-10-17）：两者说的是同一件事，分两列白占近 300px，
    // 是主表必须横向滚动的直接原因。
    { key: 'storeFulfillment', visible: true },
    { key: 'shipmentDeadline', visible: true },
    { key: 'orderedAt', visible: true },
    // 平台运单号默认收起（2026-10-17）。实测 100 单里 68 单有值，但 68 单**全部**
    // 与平台单号相同——OZON 官方物流（rFBS）的 tracking_number 就是 posting number，
    // 列表里它等于把订单号重复一列，还占 170px。换承运商后才会出现真正的运单号，
    // 需要时在这里打开即可（打开后主表会重新出现横向滚动，属预期）。
    { key: 'platformTrackingNo', visible: false },
  ],
  expandedColumns: [
    { key: 'image', visible: true },
    { key: 'sku', visible: true },
    { key: 'offerId', visible: true },
    { key: 'quantity', visible: true },
    { key: 'unitPrice', visible: true },
    { key: 'totalPrice', visible: true },
    { key: 'latestPurchasePrice', visible: true },
    { key: 'fulfillmentStatus', visible: true },
  ],
};

export function loadViewSettings(): OrdersViewSettings {
  try {
    const raw = localStorage.getItem(VIEW_SETTINGS_KEY);
    if (raw === null) {
      return DEFAULT_VIEW_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<OrdersViewSettings>;
    return {
      ...DEFAULT_VIEW_SETTINGS,
      ...parsed,
      // 前向兼容：新增列自动出现在尾部。
      mainColumns:
        parsed.mainColumns === undefined
          ? DEFAULT_VIEW_SETTINGS.mainColumns
          : [
              ...parsed.mainColumns,
              ...DEFAULT_VIEW_SETTINGS.mainColumns.filter(
                (column) => !parsed.mainColumns?.some((existing) => existing.key === column.key),
              ),
            ],
      expandedColumns:
        parsed.expandedColumns === undefined
          ? DEFAULT_VIEW_SETTINGS.expandedColumns
          : [
              ...parsed.expandedColumns,
              ...DEFAULT_VIEW_SETTINGS.expandedColumns.filter(
                (column) =>
                  !parsed.expandedColumns?.some((existing) => existing.key === column.key),
              ),
            ],
    };
  } catch {
    // storage 不可用（隐私模式）→ 仅会话内生效。
    return DEFAULT_VIEW_SETTINGS;
  }
}
