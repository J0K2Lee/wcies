import { describe, expect, it, vi } from 'vitest';
import {
  BusinessCodeService,
  formatBrandCode,
  formatCategoryCode,
  formatSkuCode,
  formatStoreCode,
  formatWarehouseCode,
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

  it('formats brand / category codes', () => {
    expect(formatBrandCode(1)).toBe('BN00001');
    expect(formatCategoryCode(251)).toBe('CN00251');
  });

  it('formats the global SKU code SKU%09d (V1 decision D2)', () => {
    expect(formatSkuCode(1)).toBe('SKU000000001');
    expect(formatSkuCode(12002)).toBe('SKU000012002');
    // Width is a minimum width: overflow carries naturally (never an error).
    expect(formatSkuCode(1000000000)).toBe('SKU1000000000');
  });

  it('carries overflow naturally instead of failing', () => {
    // Width is a minimum width (decision #10): %02d of 100 is "100".
    expect(formatWarehouseCode('SELF', 100)).toBe('ZG-100');
    expect(formatStoreCode('OZON', 1000)).toBe('ON-1000');
    expect(formatBrandCode(100000)).toBe('BN100000');
    expect(formatSkuCode(1000000000)).toBe('SKU1000000000');
  });

  it('builds scope keys', () => {
    expect(warehouseScope('SELF')).toBe('warehouse:SELF');
    expect(storeScope('WB')).toBe('store:WB');
  });
});

describe('nextSkuCodeGlobal (V1 decision D2)', () => {
  /** Service whose DataSource hands out the given sequence values in order. */
  function serviceWithSequence(values: number[]): {
    service: BusinessCodeService;
    query: ReturnType<typeof vi.fn>;
  } {
    let index = 0;
    const query = vi.fn(async () => [
      { next_value: String(values[Math.min(index++, values.length - 1)]) },
    ]);
    const service = new BusinessCodeService({ query } as never);
    return { service, query };
  }

  it('takes numbers from the single global "sku" scope and formats SKU%09d', async () => {
    const { service, query } = serviceWithSequence([12002, 12003, 12004]);
    expect(await service.nextSkuCodeGlobal()).toBe('SKU000012002');
    expect(await service.nextSkuCodeGlobal()).toBe('SKU000012003');
    expect(await service.nextSkuCodeGlobal()).toBe('SKU000012004');
    // Every take hits the 'sku' scope (never a per-product scope).
    for (const call of query.mock.calls) {
      expect(call[1]).toEqual(['sku']);
    }
  });

  it('first take = migration-seeded start + 1 (T1 backfilled max + 1)', async () => {
    // Migration 20261013_001 seeds next_value = max suffix (e.g. 12001);
    // next() increments before returning, so the first SKU is 12002.
    const { service } = serviceWithSequence([12002]);
    expect(await service.nextSkuCodeGlobal()).toBe('SKU000012002');
  });

  it('consumes the sequence on the caller manager when given (InTx flows)', async () => {
    const { service, query } = serviceWithSequence([12002]);
    const manager = { query: vi.fn(async () => [{ next_value: '12002' }]) };
    expect(await service.nextSkuCodeGlobal(manager as never)).toBe('SKU000012002');
    // The InTx manager is used, NOT the data source.
    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });
});
