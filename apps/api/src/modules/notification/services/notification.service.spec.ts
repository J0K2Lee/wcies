import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { NotificationService } from './notification.service';
import { NotificationRepository } from '../repositories/notification.repository';
import { FeishuProvider } from '../providers/feishu.provider';

/**
 * 拦截通知的文案必须是**事实陈述**（2026-10-25 用户反馈）：
 * 订单是被取消的那一方，商品仍处于「已拣货」——不能写成「拣货商品已取消」，
 * 那会让通知与订单行状态自相矛盾，也读不出「拣货已完成、需要找回实物」。
 */
function build() {
  const inserted: Array<Record<string, unknown>> = [];
  const repository = {
    insert: vi.fn(async (_manager: unknown, row: Record<string, unknown>) => {
      inserted.push(row);
      return { id: 'n-1', ...row };
    }),
    list: vi.fn(),
    findOrderStatuses: vi.fn(),
  };
  const service = new NotificationService(
    {
      transaction: vi.fn(async (work: (manager: unknown) => Promise<unknown>) => work({})),
    } as unknown as DataSource,
    repository as unknown as NotificationRepository,
    { sendText: vi.fn() } as unknown as FeishuProvider,
    new ConfigService({}),
    { add: vi.fn() } as unknown as Queue,
  );
  return { service, inserted, repository };
}

describe('notifyInterceptionRequired 文案（2026-10-25）', () => {
  it('说清「订单已取消 + 商品仍已拣货」，不说「拣货商品已取消」', async () => {
    const { service, inserted } = build();
    await service.notifyInterceptionRequired({
      orderNo: 'ORD00000728',
      orderItemId: 'item-1',
      interceptionId: 'itc-1',
      interceptionNo: 'ITC00000002',
      skuCode: 'SKU000012006',
      warehouseCode: 'ZG-01',
      remainingQty: '1.000',
    });

    const content = inserted[0]?.['content'] as string;
    expect(content).toContain('订单 ORD00000728 已取消');
    expect(content).toContain('已拣货完成（未出库');
    expect(content).not.toContain('拣货商品已取消');
    expect(inserted[0]?.title).toBe('需要拦截：订单 ORD00000728（ITC00000002）');
  });
});

/**
 * 通知状态 ≠ 订单状态（2026-10-26 用户要求分两列）：
 * 投递状态（SENT/FAILED）是通知自己的事实；订单状态取关联订单的当前 ERP 状态，
 * 拦截类通知要穿过 order_interceptions 找到订单。
 */
describe('list 派生 orderStatus（通知状态与订单状态分离）', () => {
  it('拦截类通知返回其订单的当前 ERP 状态；其它类型为 null', async () => {
    const { service, repository } = build();
    repository.list.mockResolvedValue({
      rows: [
        {
          id: 'n-1',
          type: 'ORDER_INTERCEPTION_REQUIRED',
          channel: 'SYSTEM',
          referenceType: 'ORDER_INTERCEPTION',
          referenceId: 'itc-1',
          recipient: null,
          title: '需要拦截：订单 ORD00000728（ITC00000002）',
          content: '…',
          status: 'SENT',
          attemptCount: 1,
          lastError: null,
          sentAt: new Date(),
          failedAt: null,
          createdAt: new Date(),
        },
        {
          id: 'n-2',
          type: 'SYNC_FAILED',
          channel: 'SYSTEM',
          referenceType: 'STORE',
          referenceId: 'store-1',
          recipient: null,
          title: '同步失败',
          content: '…',
          status: 'SENT',
          attemptCount: 1,
          lastError: null,
          sentAt: new Date(),
          failedAt: null,
          createdAt: new Date(),
        },
      ],
      total: 2,
    });
    repository.findOrderStatuses.mockImplementation(
      async (referenceType: string, ids: readonly string[]) =>
        referenceType === 'ORDER_INTERCEPTION' && ids.includes('itc-1')
          ? new Map([['itc-1', 'CANCELLED']])
          : new Map(),
    );

    const page = await service.list({}, { page: 1, pageSize: 20 });
    expect(page.items[0]).toMatchObject({ id: 'n-1', status: 'SENT', orderStatus: 'CANCELLED' });
    // 非订单类通知没有订单状态
    expect(page.items[1]).toMatchObject({ id: 'n-2', status: 'SENT', orderStatus: null });
    // 每种 referenceType 只查一次
    expect(repository.findOrderStatuses).toHaveBeenCalledTimes(2);
  });
});
