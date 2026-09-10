import { describe, expect, it } from 'vitest';
import {
  formatBrandCode,
  formatCategoryCode,
  formatProductCode,
  formatSkuCode,
  formatStoreCode,
  formatWarehouseCode,
  skuScope,
  storeScope,
  warehouseScope,
} from './business-code.service';

describe('business code formatting (decision 0001/0002)', () => {
  it('formats warehouse codes per type scope', () => {
    expect(formatWarehouseCode('SELF', 1)).toBe('ZG-01');
    expect(formatWarehouseCode('PLATFORM', 1)).toBe('PT-01');
    expect(formatWarehouseCode('THIRD_PARTY', 1)).toBe('SF-01');
    expect(formatWarehouseCode('RETURN_TEMP', 1)).toBe('TH-01');
  });

  it('formats store codes per platform scope', () => {
    expect(formatStoreCode('OZON', 1)).toBe('ON-001');
    expect(formatStoreCode('WB', 1)).toBe('WS-001');
    expect(formatStoreCode('YANDEX', 12)).toBe('YX-012');
  });

  it('formats brand / category / product codes', () => {
    expect(formatBrandCode(1)).toBe('BN00001');
    expect(formatCategoryCode(251)).toBe('CN00251');
    expect(formatProductCode(1)).toBe('PN000001');
  });

  it('derives SKU codes from the product sequence', () => {
    expect(formatSkuCode(1, 1)).toBe('SKU000001001');
    expect(formatSkuCode(1, 2)).toBe('SKU000001002');
    expect(formatSkuCode(12345, 7)).toBe('SKU012345007');
  });

  it('carries overflow naturally instead of failing', () => {
    // Width is a minimum width (decision #10): %02d of 100 is "100".
    expect(formatWarehouseCode('SELF', 100)).toBe('ZG-100');
    expect(formatStoreCode('OZON', 1000)).toBe('ON-1000');
    expect(formatBrandCode(100000)).toBe('BN100000');
    expect(formatProductCode(1000000)).toBe('PN1000000');
    expect(formatSkuCode(1234567, 1234)).toBe('SKU12345671234');
  });

  it('builds scope keys', () => {
    expect(warehouseScope('SELF')).toBe('warehouse:SELF');
    expect(storeScope('WB')).toBe('store:WB');
    expect(skuScope('0d96d8ba-0000-0000-0000-000000000001')).toBe(
      'sku:0d96d8ba-0000-0000-0000-000000000001',
    );
  });
});
