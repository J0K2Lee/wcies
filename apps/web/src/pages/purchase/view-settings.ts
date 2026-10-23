/**
 * 采购单页「视图设置」的持久化与默认值（2026-10-24 用户需求）。
 *
 * 与订单页同一套思路：纯 localStorage 的展示偏好，不进后端。放在独立文件里，
 * 让序列化格式只有一个落点（改默认值/加字段时只看这里）。
 */
export interface PurchaseOrdersViewSettings {
  /** 默认展开所有采购单的明细行。 */
  defaultExpandAll: boolean;
  /** 展开明细里显示 SKU 图片列。 */
  showImages: boolean;
  /** 图片边长（px，方形 contain）。 */
  imageSize: number;
}

export const PURCHASE_VIEW_SETTINGS_KEY = 'wcies.purchase-orders.view.v1';

export const DEFAULT_PURCHASE_VIEW_SETTINGS: PurchaseOrdersViewSettings = {
  defaultExpandAll: false,
  showImages: true,
  // 40 与 SKU 选择器的缩略图一致；明细行只有「SKU/数量/成本」三行信息，
  // 再大就把行高撑起来了。
  imageSize: 40,
};

export function loadPurchaseViewSettings(): PurchaseOrdersViewSettings {
  try {
    const raw = window.localStorage.getItem(PURCHASE_VIEW_SETTINGS_KEY);
    if (raw === null) {
      return DEFAULT_PURCHASE_VIEW_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<PurchaseOrdersViewSettings>;
    // 前向兼容合并：新增字段缺省时取默认值，旧偏好不会被判为非法。
    return {
      ...DEFAULT_PURCHASE_VIEW_SETTINGS,
      ...parsed,
    };
  } catch {
    return DEFAULT_PURCHASE_VIEW_SETTINGS;
  }
}

export function savePurchaseViewSettings(settings: PurchaseOrdersViewSettings): void {
  try {
    window.localStorage.setItem(PURCHASE_VIEW_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 隐私模式/配额满：偏好不持久化不影响业务。
  }
}
