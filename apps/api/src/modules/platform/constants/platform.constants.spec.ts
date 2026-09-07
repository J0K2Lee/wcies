import { describe, expect, it } from 'vitest';
import { platformCodeOfFulfillmentMode, isFulfillmentMode } from '../constants/platform.constants';

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
