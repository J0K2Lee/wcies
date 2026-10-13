import { describe, expect, it, vi } from 'vitest';
import { WarehouseBinBatchInvalidError } from '../errors/warehouse-errors';
import {
  expandRange,
  formatBinCode,
  formatRack,
  normalizeSegment,
  WarehouseBinService,
} from './warehouse-bin.service';
import { WarehouseBinEntity } from '../entities/warehouse-bin.entity';

describe('expandRange (batch bin generation, task §41)', () => {
  it('expands inclusive numeric ranges keeping zero padding', () => {
    expect(expandRange('A01', 'A05', 'rack')).toEqual(['A01', 'A02', 'A03', 'A04', 'A05']);
    expect(expandRange('01', '04', 'level')).toEqual(['01', '02', '03', '04']);
  });

  it('accepts single-element ranges', () => {
    expect(expandRange('A01', 'A01', 'rack')).toEqual(['A01']);
  });

  it('grows width when numbers exceed the padding', () => {
    expect(expandRange('A09', 'A11', 'rack')).toEqual(['A09', 'A10', 'A11']);
  });

  it('rejects non-numeric endpoints', () => {
    expect(() => expandRange('ABC', 'ABD', 'rack')).toThrow(WarehouseBinBatchInvalidError);
  });

  it('rejects mismatched prefixes', () => {
    expect(() => expandRange('A01', 'B05', 'rack')).toThrow(WarehouseBinBatchInvalidError);
  });

  it('rejects reversed ranges', () => {
    expect(() => expandRange('A05', 'A01', 'rack')).toThrow(WarehouseBinBatchInvalidError);
  });
});

describe('formatBinCode (decision 0010: one string, warehouse-prefixed)', () => {
  it('builds warehouseCode-rack-level', () => {
    expect(formatBinCode('ZG-01', 'A05', '1')).toBe('ZG-01-A05-1');
  });

  it('appends the optional position segment', () => {
    expect(formatBinCode('ZG-01', 'A05', '1', '02')).toBe('ZG-01-A05-1-02');
  });

  it('treats an empty or null position as absent', () => {
    expect(formatBinCode('ZG-01', 'A05', '1', '')).toBe('ZG-01-A05-1');
    expect(formatBinCode('ZG-01', 'A05', '1', null)).toBe('ZG-01-A05-1');
  });
});

describe('formatRack (zone prefixes the rack, shared by both create paths)', () => {
  it('combines zone and zero-padded rack number', () => {
    expect(formatRack('A', 1)).toBe('A01');
    expect(formatRack('A', 12)).toBe('A12');
  });

  it('grows the padding past 99 instead of wrapping', () => {
    expect(formatRack('B', 100)).toBe('B100');
  });

  it('omits the prefix when there is no zone', () => {
    expect(formatRack(null, 3)).toBe('03');
  });
});

describe('normalizeSegment (01 and 1 must not become two codes)', () => {
  it('drops leading zeros from numeric segments', () => {
    expect(normalizeSegment('01')).toBe('1');
    expect(normalizeSegment('02')).toBe('2');
    expect(normalizeSegment('10')).toBe('10');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSegment('  3  ')).toBe('3');
  });

  it('keeps free-form imported segments untouched', () => {
    expect(normalizeSegment('A01')).toBe('A01');
  });

  it('returns null for empty or missing input', () => {
    expect(normalizeSegment('')).toBeNull();
    expect(normalizeSegment('   ')).toBeNull();
    expect(normalizeSegment(undefined)).toBeNull();
    expect(normalizeSegment(null)).toBeNull();
  });
});

/**
 * 批量删除（用户指示 2026-09-28）：逐个零引用规则、部分成功语义。
 */
describe('batchRemove (per-bin zero-reference rule, partial success)', () => {
  const operator = { userId: null, username: 'test' };

  function build(
    bins: Array<Partial<WarehouseBinEntity> & { id: string }>,
    referencesByBin: Record<string, Array<{ table: string; count: number }>> = {},
  ) {
    const binMap = new Map(
      bins.map((bin) => [bin.id, { warehouseId: 'wh-1', binCode: `BIN-${bin.id}`, ...bin }]),
    );
    const repository = {
      findWarehouseById: vi.fn().mockResolvedValue({ id: 'wh-1', warehouseCode: 'ZG-01' }),
      findBinById: vi.fn(async (id: string) => binMap.get(id) ?? null),
      countBinReferences: vi.fn(async (id: string) => referencesByBin[id] ?? []),
      deleteBin: vi.fn().mockResolvedValue(undefined),
    };
    const operationLog = { record: vi.fn().mockResolvedValue(undefined) };
    const service: WarehouseBinService = Object.assign(
      Object.create(WarehouseBinService.prototype) as WarehouseBinService,
      { repository, operationLog },
    );
    return { service, repository, operationLog };
  }

  it('deletes zero-reference bins and reports in-use / missing / foreign ones item by item', async () => {
    const { service, repository } = build(
      [
        { id: 'bin-free-1' },
        { id: 'bin-free-2' },
        { id: 'bin-used' },
        { id: 'bin-foreign', warehouseId: 'wh-OTHER' },
      ],
      {
        'bin-used': [{ table: 'inventory_balances', count: 3 }],
      },
    );

    const result = await service.batchRemove(
      'wh-1',
      ['bin-free-1', 'bin-used', 'bin-missing', 'bin-free-2', 'bin-foreign'],
      operator,
    );

    expect(result.deletedCount).toBe(2);
    expect(repository.deleteBin).toHaveBeenCalledTimes(2);
    expect(result.failures).toHaveLength(3);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          binId: 'bin-used',
          binCode: 'BIN-bin-used',
          reason: expect.stringContaining('inventory_balances'),
        }),
        expect.objectContaining({
          binId: 'bin-missing',
          binCode: null,
          reason: expect.stringContaining('不存在'),
        }),
        expect.objectContaining({
          binId: 'bin-foreign',
          reason: expect.stringContaining('不属于该仓库'),
        }),
      ]),
    );
    // Each deleted bin gets its own DELETE log + one BATCH_DELETE summary.
    const actions = (
      service as unknown as { operationLog: { record: ReturnType<typeof vi.fn> } }
    ).operationLog.record.mock.calls.map(
      (call: unknown[]) => (call[0] as { action: string }).action,
    );
    expect(actions.filter((action) => action === 'DELETE')).toHaveLength(2);
    expect(actions).toContain('BATCH_DELETE');
  });

  it('deduplicates ids so a repeated selection deletes once', async () => {
    const { service, repository } = build([{ id: 'bin-free-1' }]);
    const result = await service.batchRemove('wh-1', ['bin-free-1', 'bin-free-1'], operator);
    expect(result).toEqual({ deletedCount: 1, failures: [] });
    expect(repository.deleteBin).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized batches with the domain error', async () => {
    const { service } = build([]);
    const ids = Array.from({ length: 2001 }, (_, index) => `bin-${index}`);
    await expect(service.batchRemove('wh-1', ids, operator)).rejects.toBeInstanceOf(
      WarehouseBinBatchInvalidError,
    );
  });
});
