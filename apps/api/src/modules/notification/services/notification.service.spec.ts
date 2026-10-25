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
  return { service, inserted };
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
