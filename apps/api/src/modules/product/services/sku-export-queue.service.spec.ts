import { describe, expect, it, vi } from 'vitest';
import { SkuExportQueueService } from './sku-export-queue.service';
import {
  InvalidSkuExportColumnError,
  SkuExportInProgressError,
  SkuExportJobNotFoundError,
} from '../errors/sku-export-errors';

/**
 * 入队前的守卫（2026-11-04）：非法列必须在提交时 422（而不是变成一个失败的
 * job）、同一用户单飞、任务只能本人查询。
 */

interface FakeJob {
  id: string;
  data: { userId: string | null };
  getState: () => Promise<string>;
  progress: number;
  returnvalue: unknown;
  failedReason?: string;
}

function build(pendingJobs: FakeJob[] = []) {
  const add = vi.fn(async () => ({ id: '42' }));
  const jobsById = new Map<string, FakeJob>();
  const queue = {
    getJobs: vi.fn(async () => pendingJobs),
    add,
    getJob: vi.fn(async (id: string) => jobsById.get(id) ?? null),
  };
  const service = new SkuExportQueueService(
    queue as never,
    { getSignedUrl: vi.fn(async () => 'https://s3/signed') } as never,
  );
  return { service, add, queue, jobsById };
}

const BASE_DATA = {
  columns: ['skuCode'],
  sortBy: 'skuCode' as const,
  sortOrder: 'asc' as const,
  tzOffsetMinutes: 480,
};

describe('SkuExportQueueService', () => {
  it('未知列 → 422 且不入队', async () => {
    const { service, add } = build();
    await expect(
      service.createExport(
        { ...BASE_DATA, columns: ['skuCode', 'noSuchColumn'] },
        { userId: 'u1' },
      ),
    ).rejects.toBeInstanceOf(InvalidSkuExportColumnError);
    expect(add).not.toHaveBeenCalled();
  });

  it('空列 → 422', async () => {
    const { service, add } = build();
    await expect(
      service.createExport({ ...BASE_DATA, columns: [] }, { userId: 'u1' }),
    ).rejects.toBeInstanceOf(InvalidSkuExportColumnError);
    expect(add).not.toHaveBeenCalled();
  });

  it('同一用户已有排队中的导出 → 409，不重复入队', async () => {
    const { service, add } = build([
      {
        id: '1',
        data: { userId: 'u1' },
        getState: async () => 'waiting',
        progress: 0,
        returnvalue: null,
      },
    ]);
    await expect(service.createExport({ ...BASE_DATA }, { userId: 'u1' })).rejects.toBeInstanceOf(
      SkuExportInProgressError,
    );
    expect(add).not.toHaveBeenCalled();
  });

  it('别人的任务不阻塞自己；入队时带上 userId', async () => {
    const { service, add } = build([
      {
        id: '1',
        data: { userId: 'other' },
        getState: async () => 'active',
        progress: 0,
        returnvalue: null,
      },
    ]);
    await service.createExport({ ...BASE_DATA }, { userId: 'u1' });
    expect(add).toHaveBeenCalledTimes(1);
    expect((add.mock.calls[0] as unknown as [string, { userId: string }])[1].userId).toBe('u1');
  });

  it('完成的任务返回签名地址与行数', async () => {
    const { service, jobsById } = build();
    jobsById.set('7', {
      id: '7',
      data: { userId: 'u1' },
      getState: async () => 'completed',
      progress: 100,
      returnvalue: { objectKey: 'exports/sku/a.xlsx', rowCount: 12, fileName: 'a.xlsx' },
    });
    await expect(service.getStatus('7', { userId: 'u1' })).resolves.toMatchObject({
      status: 'COMPLETED',
      rowCount: 12,
      fileName: 'a.xlsx',
      downloadUrl: 'https://s3/signed',
    });
  });

  it('失败的任务带回失败原因', async () => {
    const { service, jobsById } = build();
    jobsById.set('8', {
      id: '8',
      data: { userId: 'u1' },
      getState: async () => 'failed',
      progress: 40,
      returnvalue: null,
      failedReason: '数据库超时',
    });
    await expect(service.getStatus('8', { userId: 'u1' })).resolves.toMatchObject({
      status: 'FAILED',
      error: '数据库超时',
    });
  });

  it('查询别人的任务 → 404（不区分 403，避免探测）', async () => {
    const { service, jobsById } = build();
    jobsById.set('9', {
      id: '9',
      data: { userId: 'other' },
      getState: async () => 'completed',
      progress: 100,
      returnvalue: null,
    });
    await expect(service.getStatus('9', { userId: 'u1' })).rejects.toBeInstanceOf(
      SkuExportJobNotFoundError,
    );
  });
});
