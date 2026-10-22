import { describe, expect, it } from 'vitest';
import { buildOzonProductUrl, buildPlatformProductUrl, buildYandexSlug } from './platformUrl';

describe('buildYandexSlug (2026-10-22 真实链接反推)', () => {
  it('reproduces the slug of a real Yandex card URL', () => {
    // 用户提供的真实链接：
    // https://market.yandex.ru/card/termos-stanley-40oz-s-ruchkoy-.../5928234246
    expect(
      buildYandexSlug(
        'Термос Stanley 40oz с ручкой из нержавеющей стали 304 большой объем 1.18L для взрослых',
      ),
    ).toBe(
      'termos-stanley-40oz-s-ruchkoy-iz-nerzhaveyushchey-stali-304-bolshoy-obyem-118l-dlya-vzroslykh',
    );
  });

  it('drops soft signs and transliterates hard signs to y', () => {
    expect(buildYandexSlug('большой')).toBe('bolshoy');
    expect(buildYandexSlug('объем')).toBe('obyem');
  });

  it('collapses punctuation into single hyphens and trims edges', () => {
    expect(buildYandexSlug('  Мышь,  беспроводная — RGB!  ')).toBe('mysh-besprovodnaya-rgb');
  });

  it('keeps latin and digits untouched', () => {
    expect(buildYandexSlug('VALKYRIE VK87 MAX V2 - HEIJIN')).toBe('valkyrie-vk87-max-v2-heijin');
  });
});

describe('buildPlatformProductUrl', () => {
  it('builds the Yandex card URL with slug and card id', () => {
    expect(buildPlatformProductUrl('YANDEX', '5928234246', 'Термос Stanley 1.18L')).toBe(
      'https://market.yandex.ru/card/termos-stanley-118l/5928234246',
    );
  });

  it('returns null for Yandex without a title (never guesses a URL)', () => {
    expect(buildPlatformProductUrl('YANDEX', '5928234246')).toBeNull();
    expect(buildPlatformProductUrl('YANDEX', '5928234246', '   ')).toBeNull();
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
