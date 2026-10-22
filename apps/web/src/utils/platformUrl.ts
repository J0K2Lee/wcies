/**
 * 平台商品页公开 URL 拼接（ERP 建议#3；OZON 键位修正 2026-09-28）。
 *
 * OZON 商品页的键是**平台 SKU ID**（FBS sku，即订单行 platformSkuId；用户
 * 实测：https://www.ozon.ru/product/3312935464 其中 3312935464 为平台
 * skuid）——不是 Listing 的 platform_product_id（那是 product_id），因此
 * OZON 只走 buildOzonProductUrl，通用拼接器不再处理 OZON。
 *
 * WB 用 nmID（= Listing 的 platform_product_id）。
 *
 * YANDEX **不拼卡片地址**（2026-10-22 实测修正）：公开页
 * `market.yandex.ru/card/<slug>/<id>` 里的 id 并不等于 Partner API 的
 * `marketSku`，用 marketSku 拼出来的链接对部分卡片直接 404；slug 本身只是
 * 占位路径段（填什么都路由，实测 `card/x/<id>` 可打开）。唯一可靠来源是
 * offer-mappings 的 `showcaseUrls[].showcaseUrl`（listing 同步已存进
 * `listing.url`）。listing.url 缺失时退回 Market 搜索页（按商品名），
 * 保证永远可点。
 *
 * listing.url（人工维护 / 平台给的 showcaseUrl）优先级永远高于兜底。
 */

export function buildOzonProductUrl(platformSkuId: string): string {
  return `https://www.ozon.ru/product/${platformSkuId}`;
}

/** Yandex 没有卡片链接时的兜底：按商品名搜索（永远能打开）。 */
export function buildYandexSearchUrl(title: string): string | null {
  const text = title.trim();
  return text === '' ? null : `https://market.yandex.ru/search?text=${encodeURIComponent(text)}`;
}

/**
 * `title` 只有 YANDEX 兜底搜索需要；WB 可省略。
 * 返回 null 表示既没有可拼的地址、也没有可兜底的文本 —— 调用方提示（§88）。
 */
export function buildPlatformProductUrl(
  platformCode: string,
  platformProductId: string,
  title?: string | null,
): string | null {
  if (platformCode === 'WB') {
    return `https://www.wildberries.ru/catalog/${platformProductId}/detail.aspx`;
  }
  if (platformCode === 'YANDEX') {
    return title === null || title === undefined ? null : buildYandexSearchUrl(title);
  }
  return null;
}
