import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ShippingLabelService } from '../../shipment/services/shipping-label.service';
import { ShippingLabelPurgeService } from './shipping-label-purge.service';

const SETTINGS = {
  purgeBatchSize: 2,
  purgeMaxBatchesPerRun: 2,
  purgeMaxRunMs: 60_000,
  purgeGraceMinutes: 0,
};

function row(id: string, createdAt = new Date('2026-10-01T00:00:00Z')) {
  return { id, objectKey: `shipping-labels/${id}.pdf`, fileName: `${id}.pdf`, createdAt };
}

function build(pages: Array<Array<ReturnType<typeof row>>>) {
  const findPurgeCandidates = vi.fn();
  for (const page of pages) {
    findPurgeCandidates.mockResolvedValueOnce(page);
  }
  findPurgeCandidates.mockResolvedValue([]);
  const purgeLabel = vi.fn(async () => true);
  const labelService = {
    findPurgeCandidates,
    purgeLabel,
  } as unknown as ShippingLabelService;
  const config = {
    getOrThrow: vi.fn(() => SETTINGS),
  } as unknown as ConfigService;
  const logger = { log: vi.fn(), warn: vi.fn() } as unknown as AppLoggerService;
  return {
    service: new ShippingLabelPurgeService(labelService, config, logger),
    findPurgeCandidates,
    purgeLabel,
  };
}

describe('ShippingLabelPurgeService (终态面单清理, 2026-10-21)', () => {
  it('按游标循环排空：两批后遇到空页停止', async () => {
    const { service, findPurgeCandidates, purgeLabel } = build([[row('a'), row('b')], [row('c')]]);

    const result = await service.sweep();

    expect(result).toMatchObject({ batches: 2, scanned: 3, purged: 3, failed: 0 });
    // 第二批必须带上一批最后一行的游标（否则删除失败的行会卡住后续行）。
    expect(findPurgeCandidates).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ after: { createdAt: row('b').createdAt, id: 'b' } }),
    );
    expect(purgeLabel).toHaveBeenCalledTimes(3);
    // 最后一批不满额 → 没有积压。
    expect(result.backlogContinues).toBe(false);
  });

  it('单张失败不中断其余，并计入 failed', async () => {
    const { service, purgeLabel } = build([[row('a'), row('b')]]);
    purgeLabel.mockRejectedValueOnce(new Error('s3 unavailable'));

    const result = await service.sweep();

    expect(result).toMatchObject({ scanned: 2, purged: 1, failed: 1 });
    expect(purgeLabel).toHaveBeenCalledTimes(2);
  });

  it('达到单轮批次数上限即停，并标记仍有积压', async () => {
    const { service, findPurgeCandidates } = build([
      [row('a'), row('b')],
      [row('c'), row('d')],
      [row('e'), row('f')],
    ]);

    const result = await service.sweep();

    // maxBatchesPerRun = 2，第三页不再查询。
    expect(findPurgeCandidates).toHaveBeenCalledTimes(2);
    expect(result.batches).toBe(2);
    expect(result.backlogContinues).toBe(true);
  });

  it('无候选时不调用清理', async () => {
    const { service, purgeLabel } = build([[]]);

    const result = await service.sweep();

    expect(result).toMatchObject({ batches: 0, purged: 0, failed: 0, backlogContinues: false });
    expect(purgeLabel).not.toHaveBeenCalled();
  });
});
