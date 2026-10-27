import { describe, expect, it, vi } from 'vitest';
import { OzonWebhookController } from './ozon-webhook.controller';
import { WebhookIngestService } from '../services/webhook.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { WebhookPayloadInvalidError } from '../errors/sync-errors';

/**
 * OZON 推送入口的响应契约（2026-10-27，订阅被平台自动停用的根因回归）：
 *
 * - 平台连通性探测（body 不带 message_type）→ **200 + 标准 ack**，不落库；
 * - message_type 存在但事件体坏了 → **422**，绝不能是 5xx；
 * - 未知店铺 → 404（保持）；
 * - 其它瞬时失败 → 200（平台重试兜底）。
 */
function makeController(ingestImpl?: (storeCode: string, payload: unknown) => Promise<string>) {
  const ingestOzon = vi.fn(ingestImpl ?? (async () => 'ACCEPTED'));
  const ingest = { ingestOzon } as unknown as WebhookIngestService;
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as AppLoggerService;
  return { controller: new OzonWebhookController(ingest, logger), ingest: ingestOzon, logger };
}

function errorWithCode(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

describe('OzonWebhookController 探测与错误语义', () => {
  it('不带 message_type 的探测请求回 200 ack，且不触发摄入', async () => {
    const { controller, ingest } = makeController();
    const ack = await controller.receive('ON-003', {});
    expect(ack).toMatchObject({ version: '2.0', name: 'WCIES' });
    expect(typeof ack.time).toBe('string');
    expect(ingest).not.toHaveBeenCalled();

    // 空 body / 平台 SDK 形状（只有 url）同样按探测处理。
    await controller.receive('ON-003', { url: 'https://example.com/hook' });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('真正的 PING（带 message_type）仍走摄入链路', async () => {
    const { controller, ingest } = makeController();
    await controller.receive('ON-003', { message_type: 'TYPE_PING' });
    expect(ingest).toHaveBeenCalledWith('ON-003', { message_type: 'TYPE_PING' });
  });

  it('事件体畸形回 422（不能是 5xx，平台会记为服务故障）', async () => {
    const { controller } = makeController(async () => {
      throw errorWithCode('PLATFORM_BAD_RESPONSE');
    });
    await expect(
      controller.receive('ON-003', { message_type: 'TYPE_STATE_CHANGED' }),
    ).rejects.toBeInstanceOf(WebhookPayloadInvalidError);
    await expect(
      controller.receive('ON-003', { message_type: 'TYPE_STATE_CHANGED' }),
    ).rejects.toMatchObject({ httpStatus: 422 });
  });

  it('未知店铺仍然 404 透传', async () => {
    const { controller } = makeController(async () => {
      throw errorWithCode('STORE_NOT_FOUND');
    });
    await expect(controller.receive('ON-999', { message_type: 'TYPE_PING' })).rejects.toMatchObject(
      { code: 'STORE_NOT_FOUND' },
    );
  });

  it('其它瞬时失败回 200（平台重试 + 轮询兜底）', async () => {
    const { controller } = makeController(async () => {
      throw new Error('db hiccup');
    });
    const ack = await controller.receive('ON-003', { message_type: 'TYPE_PING' });
    expect(ack.version).toBe('2.0');
  });
});
