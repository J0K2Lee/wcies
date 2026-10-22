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
 * YANDEX（2026-10-22 用户提供真实链接 + 实测）：商品页是
 *   https://market.yandex.ru/card/<slug>/<cardId>
 * 其中 cardId = Listing 的 platform_product_id（offer-mappings 的 offer.id），
 * slug = 商品标题的俄→拉丁转写（只做 SEO，不影响取到商品）。**只有 cardId 的
 * 形式 `card/<cardId>` 会 404**（用户实测截图），所以 slug 必须拼。
 * 例：card/5928234246 → 404；
 *     card/termos-stanley-...-dlya-vzroslykh/5928234246 → 正常商品页。
 * 转写规则按该真实链接反推（ь→丢、ъ→y、点号直接删：1.18L→118l）。
 *
 * listing.url（人工维护）优先级永远高于拼接结果。
 */

/** 俄文字母 → 拉丁转写（按 Yandex Market 真实商品页 slug 反推，2026-10-22）。 */
const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: 'y',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/**
 * 商品标题 → Yandex 商品页 slug。
 * 点号直接删除（`1.18L` → `118l`，与真实链接一致），其余非字母数字折叠成单个 `-`。
 */
export function buildYandexSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9а-яё]+/g, '-')
    .replace(/[а-яё]/g, (char) => CYRILLIC_TO_LATIN[char] ?? '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildOzonProductUrl(platformSkuId: string): string {
  return `https://www.ozon.ru/product/${platformSkuId}`;
}

/**
 * `title` 只有 YANDEX 需要（拼 slug）；WB 可省略。
 * 缺标题时返回 null —— 由调用方提示，不猜 URL（AGENTS.md §88）。
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
    const slug = title === null || title === undefined ? '' : buildYandexSlug(title);
    return slug === '' ? null : `https://market.yandex.ru/card/${slug}/${platformProductId}`;
  }
  return null;
}
