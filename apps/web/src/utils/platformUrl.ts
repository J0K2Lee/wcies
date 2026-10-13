/**
 * 平台商品页公开 URL 拼接（ERP 建议#3；OZON 键位修正 2026-09-28）。
 *
 * OZON 商品页的键是**平台 SKU ID**（FBS sku，即订单行 platformSkuId；用户
 * 实测：https://www.ozon.ru/product/3312935464 其中 3312935464 为平台
 * skuid）——不是 Listing 的 platform_product_id（那是 product_id），因此
 * OZON 只走 buildOzonProductUrl，通用拼接器不再处理 OZON。
 * WB 用 nmID（= Listing 的 platform_product_id）。Yandex 商品页 URL 规则
 * 未核实——返回 null，调用方提示，不猜平台 URL（AGENTS.md §88）。
 * listing.url（人工维护）优先级永远高于拼接结果。
 */
export function buildOzonProductUrl(platformSkuId: string): string {
  return `https://www.ozon.ru/product/${platformSkuId}`;
}

export function buildPlatformProductUrl(
  platformCode: string,
  platformProductId: string,
): string | null {
  if (platformCode === 'WB') {
    return `https://www.wildberries.ru/catalog/${platformProductId}/detail.aspx`;
  }
  return null;
}
