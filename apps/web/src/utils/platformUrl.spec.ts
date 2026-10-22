import { describe, expect, it } from 'vitest';
import { buildOzonProductUrl, buildPlatformProductUrl, buildYandexSearchUrl } from './platformUrl';

describe('buildYandexSearchUrl', () => {
  it('encodes the product name into a Market search URL', () => {
    expect(buildYandexSearchUrl('MCHOSE A7 V3 Ultra+ / 59 г')).toBe(
      'https://market.yandex.ru/search?text=MCHOSE%20A7%20V3%20Ultra%2B%20%2F%2059%20%D0%B3',
    );
  });

  it('returns null for a blank title', () => {
    expect(buildYandexSearchUrl('   ')).toBeNull();
  });
});

describe('buildPlatformProductUrl', () => {
  it('never fabricates a Yandex card URL — falls back to search by title', () => {
    // 2026-10-22 实测：marketSku 拼 card/<slug>/<id> 对部分卡片 404。
    expect(buildPlatformProductUrl('YANDEX', '6087881269', 'MCHOSE A7 V3 Ultra+')).toBe(
      'https://market.yandex.ru/search?text=MCHOSE%20A7%20V3%20Ultra%2B',
    );
  });

  it('returns null for Yandex without a title (no fallback text available)', () => {
    expect(buildPlatformProductUrl('YANDEX', '6087881269')).toBeNull();
  });

  it('builds the WB catalog URL from nmID', () => {
    expect(buildPlatformProductUrl('WB', '123456789')).toBe(
      'https://www.wildberries.ru/catalog/123456789/detail.aspx',
    );
  });

  it('keeps OZON on its dedicated sku-id builder', () => {
    expect(buildPlatformProductUrl('OZON', '999')).toBeNull();
    expect(buildOzonProductUrl('3312935464')).toBe('https://www.ozon.ru/product/3312935464');
  });
});
