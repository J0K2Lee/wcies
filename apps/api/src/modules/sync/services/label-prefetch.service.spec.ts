import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { LABEL_JOB, LabelPrefetchService } from './label-prefetch.service';

const SETTINGS = {
  prefetchEnabled: true,
  prefetchDelayMs: 60_000,
  prefetchMaxAttempts: 6,
  prefetchFromSync: true,
  batchFetchChunk: 20,
};

function build(overrides: Partial<typeof SETTINGS> = {}) {
  const add = vi.fn(async (_name: string, _data: unknown, _options: unknown) => ({ id: 'job-1' }));
  const queue = { add } as unknown as Queue;
  const config = {
    getOrThrow: vi.fn(() => ({ ...SETTINGS, ...overrides })),
  } as unknown as ConfigService;
  const logger = { log: vi.fn(), warn: vi.fn() } as unknown as AppLoggerService;
  return { service: new LabelPrefetchService(queue, config, logger), add };
}

describe('LabelPrefetchService (组包后预取, 2026-10-21)', () => {
  it('单笔入队：延迟、重试与稳定 jobId', async () => {
    const { service, add } = build();

    await service.enqueueForOrder('order-1');

    expect(add).toHaveBeenCalledTimes(1);
    const [name, payload, options] = add.mock.calls[0] as unknown as [
      string,
      { orderIds: string[] },
      {
        delay: number;
        attempts: number;
        backoff: { type: string; delay: number };
        jobId: string;
      },
    ];
    expect(name).toBe(LABEL_JOB.prefetch);
    expect(payload).toEqual({ orderIds: ['order-1'] });
    expect(options.delay).toBe(60_000);
    expect(options.attempts).toBe(6);
    expect(options.backoff).toEqual({ type: 'exponential', delay: 60_000 });
    // BullMQ 自定义 jobId 不允许包含 ':'。
    expect(options.jobId).toBe('label-prefetch-order-1');
    expect(options.jobId).not.toContain(':');
  });

  it('关闭预取时完全不入队', async () => {
    const { service, add } = build({ prefetchEnabled: false });

    await service.enqueueForOrder('order-1');
    await service.enqueueBatch(['o1', 'o2']);

    expect(add).not.toHaveBeenCalled();
    expect(service.isEnabled()).toBe(false);
  });

  it('批量按 chunk 切块（50 单 → 20/20/10，三个 job，不逐单）', async () => {
    const { service, add } = build();
    const ids = Array.from({ length: 50 }, (_, index) => `order-${index}`);

    await service.enqueueBatch(ids, { delayMs: 0 });

    expect(add).toHaveBeenCalledTimes(3);
    const sizes = add.mock.calls.map((call) => (call[1] as { orderIds: string[] }).orderIds.length);
    expect(sizes).toEqual([20, 20, 10]);
    const jobIds = add.mock.calls.map((call) => (call[2] as { jobId: string }).jobId);
    expect(jobIds.every((jobId) => jobId.startsWith('label-prefetch-batch-'))).toBe(true);
    // 相同订单集合 → 相同 jobId（BullMQ 去重）。
    expect(new Set(jobIds).size).toBe(3);
  });

  it('批量入队去重后为空时不产生 job', async () => {
    const { service, add } = build();

    await service.enqueueBatch(['o1', 'o1', 'o1']);

    expect(add).toHaveBeenCalledTimes(1);
    expect((add.mock.calls[0]?.[1] as { orderIds: string[] }).orderIds).toEqual(['o1']);
  });

  it('入队失败只记日志，绝不向上抛（组包结果不受影响）', async () => {
    const { service, add } = build();
    add.mockRejectedValueOnce(new Error('redis down'));

    await expect(service.enqueueForOrder('order-1')).resolves.toBeUndefined();
  });

  it('同步补触发受 LABEL_PREFETCH_FROM_SYNC 控制', async () => {
    const on = build();
    await on.service.enqueueFromSync('order-1');
    expect(on.add).toHaveBeenCalledTimes(1);
    expect((on.add.mock.calls[0]?.[2] as { delay: number }).delay).toBe(0);

    const off = build({ prefetchFromSync: false });
    await off.service.enqueueFromSync('order-1');
    expect(off.add).not.toHaveBeenCalled();
  });
});
