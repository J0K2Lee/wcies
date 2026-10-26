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
    listForUser: vi.fn(),
    countUnread: vi.fn().mockResolvedValue(0),
    findRecentByDedupe: vi.fn().mockResolvedValue(null),
    listEnabledSubscriptions: vi.fn().mockResolvedValue([]),
    findBinding: vi.fn().mockResolvedValue(null),
    insertDeliveries: vi.fn().mockResolvedValue([]),
    findReferenceContexts: vi.fn(),
  };
  const queue = { add: vi.fn().mockResolvedValue(undefined) };
  const service = new NotificationService(
    {
      transaction: vi.fn(async (work: (manager: unknown) => Promise<unknown>) => work({})),
    } as unknown as DataSource,
    repository as unknown as NotificationRepository,
    { sendText: vi.fn() } as unknown as FeishuProvider,
    new ConfigService({}),
    queue as unknown as Queue,
  );
  return { service, inserted, repository, queue };
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

  it('数量按整数显示，不把数据库精度 (1.000) 写进文案', async () => {
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
    expect(content).toContain('待找回数量：1');
    expect(content).not.toContain('1.000');
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
    repository.listForUser.mockResolvedValue({
      rows: [
        {
          event: {
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
          read: false,
          deliveryStatus: 'FAILED',
        },
        {
          event: {
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
          read: true,
          deliveryStatus: null,
        },
      ],
      total: 2,
    });
    repository.findReferenceContexts.mockImplementation(
      async (referenceType: string, ids: readonly string[]) =>
        referenceType === 'ORDER_INTERCEPTION' && ids.includes('itc-1')
          ? new Map([
              [
                'itc-1',
                {
                  orderStatus: 'CANCELLED',
                  goods: {
                    interceptionStatus: 'CREATED',
                    pickBinCodes: ['ZG-01-E01-1'],
                    targetBinCode: null,
                    packageNos: [],
                  },
                },
              ],
            ])
          : new Map(),
    );

    const page = await service.list({}, { page: 1, pageSize: 20 }, 'user-1');
    expect(page.items[0]).toMatchObject({
      id: 'n-1',
      status: 'SENT',
      orderStatus: 'CANCELLED',
      goods: { interceptionStatus: 'CREATED', pickBinCodes: ['ZG-01-E01-1'] },
      isRead: false,
      deliveryStatus: 'FAILED',
    });
    // 非订单类通知没有订单状态，也没有货物位置
    expect(page.items[1]).toMatchObject({
      id: 'n-2',
      status: 'SENT',
      orderStatus: null,
      goods: null,
      isRead: true,
    });
    // 每种 referenceType 只查一次
    expect(repository.findReferenceContexts).toHaveBeenCalledTimes(2);
  });
});

/**
 * 订阅 fan-out（2026-10-26）：只有「已订阅 + 条件命中 + 通道已绑定」才会产生
 * 推送投递；默认全不订阅，所以没有规则就什么都不发。
 */
describe('publish → fan-out', () => {
  it('飞书私聊订阅命中且已绑定 → 生成投递并入队', async () => {
    const { service, repository, queue } = build();
    repository.listEnabledSubscriptions.mockResolvedValue([
      {
        id: 'rule-1',
        userId: 'user-1',
        channel: 'FEISHU_DM',
        eventType: 'ORDER_INTERCEPTION_REQUIRED',
        conditions: { level: ['WARN'] },
        enabled: true,
      },
    ]);
    repository.findBinding.mockResolvedValue({ address: 'ou_test', enabled: true });
    repository.insertDeliveries.mockResolvedValue([{ id: 'd-1' }]);

    await service.notifyInterceptionRequired({
      orderNo: 'ORD00000728',
      orderItemId: 'item-1',
      interceptionId: 'itc-1',
      interceptionNo: 'ITC00000002',
      skuCode: 'SKU000012006',
      warehouseCode: 'ZG-01',
      remainingQty: '1.000',
      storeId: 'store-1',
    });

    expect(repository.insertDeliveries).toHaveBeenCalledWith(expect.anything(), [
      { notificationId: 'n-1', userId: 'user-1', channel: 'FEISHU_DM', ruleId: 'rule-1' },
    ]);
    expect(queue.add).toHaveBeenCalledWith(
      'deliver',
      { deliveryId: 'd-1' },
      expect.objectContaining({ jobId: 'notify-delivery-d-1' }),
    );
  });

  it('订阅存在但没有绑定 open_id → 不生成投递（避免无意义失败）', async () => {
    const { service, repository, queue } = build();
    repository.listEnabledSubscriptions.mockResolvedValue([
      {
        id: 'rule-1',
        userId: 'user-1',
        channel: 'FEISHU_DM',
        eventType: 'ORDER_INTERCEPTION_REQUIRED',
        conditions: {},
        enabled: true,
      },
    ]);
    repository.findBinding.mockResolvedValue(null);

    await service.notifyInterceptionRequired({
      orderNo: 'ORD00000728',
      orderItemId: 'item-1',
      interceptionId: 'itc-1',
      interceptionNo: 'ITC00000002',
      skuCode: null,
      warehouseCode: null,
      remainingQty: '1.000',
    });

    expect(repository.insertDeliveries).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('没有任何订阅 → 只记站内事件，不推送', async () => {
    const { service, repository, queue, inserted } = build();
    repository.listEnabledSubscriptions.mockResolvedValue([]);
    await service.notifyInterceptionRequired({
      orderNo: 'ORD00000728',
      orderItemId: 'item-1',
      interceptionId: 'itc-1',
      interceptionNo: 'ITC00000002',
      skuCode: null,
      warehouseCode: null,
      remainingQty: '1.000',
    });
    expect(inserted).toHaveLength(1);
    expect(repository.insertDeliveries).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
