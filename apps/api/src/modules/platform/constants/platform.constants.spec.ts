import { describe, expect, it } from 'vitest';
import {
  FULFILLMENT_CATEGORIES,
  FULFILLMENT_MODES,
  fulfillmentCategoryOf,
  fulfillmentModesForPlatform,
  platformCodeOfFulfillmentMode,
  isFulfillmentMode,
  isExternalFulfillmentMode,
} from '../constants/platform.constants';

describe('fulfillment mode constants (task §44)', () => {
  it('maps every mode to its platform', () => {
    expect(platformCodeOfFulfillmentMode('OZON_RFBS')).toBe('OZON');
    expect(platformCodeOfFulfillmentMode('OZON_FBP')).toBe('OZON');
    expect(platformCodeOfFulfillmentMode('WB_FBS')).toBe('WB');
    expect(platformCodeOfFulfillmentMode('WB_FBW')).toBe('WB');
    expect(platformCodeOfFulfillmentMode('YANDEX_FBY')).toBe('YANDEX');
  });

  it('recognizes valid modes and rejects arbitrary strings', () => {
    expect(isFulfillmentMode('OZON_FBO')).toBe(true);
    expect(isFulfillmentMode('OZON_MAGIC')).toBe(false);
    expect(isFulfillmentMode('')).toBe(false);
  });
});

describe('fulfillment category (business-model layer, 2026-09-11)', () => {
  it('classifies seller-fulfilled modes as 自管仓', () => {
    expect(fulfillmentCategoryOf('OZON_RFBS')).toBe('SELF_MANAGED');
    expect(fulfillmentCategoryOf('OZON_FBS')).toBe('SELF_MANAGED');
    expect(fulfillmentCategoryOf('WB_FBS')).toBe('SELF_MANAGED');
    expect(fulfillmentCategoryOf('YANDEX_FBS')).toBe('SELF_MANAGED');
  });

  it('classifies platform-warehouse modes as 托管仓', () => {
    expect(fulfillmentCategoryOf('OZON_FBO')).toBe('MANAGED');
    expect(fulfillmentCategoryOf('WB_FBW')).toBe('MANAGED');
    expect(fulfillmentCategoryOf('YANDEX_FBY')).toBe('MANAGED');
  });

  it('classifies the partner-warehouse mode as 半托管', () => {
    expect(fulfillmentCategoryOf('OZON_FBP')).toBe('SEMI_MANAGED');
  });

  it('assigns every mode to exactly one known category', () => {
    for (const mode of FULFILLMENT_MODES) {
      expect(FULFILLMENT_CATEGORIES).toContain(fulfillmentCategoryOf(mode));
    }
  });

  it('keeps the stored mode platform-specific', () => {
    // The category is display-facing only; ingestion and orders.md §4.6 depend
    // on distinguishing FBO from the rest, so the raw mode must stay intact.
    expect(fulfillmentCategoryOf('OZON_FBO')).not.toBe(fulfillmentCategoryOf('OZON_FBS'));
  });
});

describe('fulfillmentModesForPlatform (bug 4: the form must not offer foreign modes)', () => {
  it('offers only the modes belonging to the store platform', () => {
    expect(fulfillmentModesForPlatform('OZON')).toEqual([
      'OZON_RFBS',
      'OZON_FBS',
      'OZON_FBO',
      'OZON_FBP',
    ]);
    expect(fulfillmentModesForPlatform('WB')).toEqual(['WB_FBS', 'WB_FBW']);
    expect(fulfillmentModesForPlatform('YANDEX')).toEqual(['YANDEX_FBS', 'YANDEX_FBY']);
  });

  it('never mixes platforms (the backend rejects such bindings)', () => {
    const ozon = fulfillmentModesForPlatform('OZON');
    expect(ozon.some((mode) => mode.startsWith('WB_'))).toBe(false);
    expect(ozon.some((mode) => mode.startsWith('YANDEX_'))).toBe(false);
  });
});

describe('isExternalFulfillmentMode (用户指示 2026-09-17：FBO/FBP 外部履约)', () => {
  it('treats platform-fulfilled modes as external (both constant and short forms)', () => {
    expect(isExternalFulfillmentMode('OZON_FBO')).toBe(true);
    expect(isExternalFulfillmentMode('OZON_FBP')).toBe(true);
    expect(isExternalFulfillmentMode('WB_FBW')).toBe(true);
    expect(isExternalFulfillmentMode('YANDEX_FBY')).toBe(true);
    // 订单头保存的是平台 mapper 的短码。
    expect(isExternalFulfillmentMode('FBO')).toBe(true);
    expect(isExternalFulfillmentMode('FBP')).toBe(true);
    expect(isExternalFulfillmentMode('FBW')).toBe(true);
    expect(isExternalFulfillmentMode('FBY')).toBe(true);
  });

  it('keeps seller-fulfilled modes internal', () => {
    expect(isExternalFulfillmentMode('OZON_FBS')).toBe(false);
    expect(isExternalFulfillmentMode('OZON_RFBS')).toBe(false);
    expect(isExternalFulfillmentMode('FBS')).toBe(false);
    expect(isExternalFulfillmentMode('RFBS')).toBe(false);
    expect(isExternalFulfillmentMode(null)).toBe(false);
    expect(isExternalFulfillmentMode(undefined)).toBe(false);
    expect(isExternalFulfillmentMode('')).toBe(false);
  });
});
