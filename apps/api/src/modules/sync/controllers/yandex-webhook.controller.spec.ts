import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { YandexWebhookController } from './yandex-webhook.controller';
import { WebhookIngestService } from '../services/webhook.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/**
 * Yandex webhook controller unit tests: IP-allowlist enforcement, the 1s
 * PING short-circuit, 400 on malformed notifications and the 200-ack
 * fallback for transient ingest failures (docs/integrations/yandex.md §4).
 */

const IN_RANGE_IP = '5.45.207.9';
const OUT_OF_RANGE_IP = '203.0.113.9';

function makeController(options: {
  ip?: string;
  allowDisabled?: boolean;
  ingest?: (storeCode: string, payload: unknown) => Promise<string>;
}) {
  const ingestYandex = vi.fn(options.ingest ?? (async () => 'ACCEPTED'));
  const ingest = { ingestYandex } as unknown as WebhookIngestService;
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'YANDEX_WEBHOOK_DISABLE_IP_ALLOWLIST') {
        return options.allowDisabled === true ? 'true' : undefined;
      }
      return undefined;
    }),
  } as unknown as ConfigService;
  const logger = { warn: vi.fn(), error: vi.fn() } as unknown as AppLoggerService;
  const controller = new YandexWebhookController(ingest, config, logger);
  const request = {
    headers: { 'cf-connecting-ip': options.ip ?? IN_RANGE_IP },
    socket: { remoteAddress: '10.0.0.1' },
  };
  return { controller, ingest, request };
}

describe('YandexWebhookController', () => {
  it('answers PING inline with {version, name, time} and no ingest work', async () => {
    const { controller, ingest, request } = makeController({});
    const ack = await controller.receive('YX-A', { notificationType: 'PING' }, request);
    expect(ack.version).toBe('1.0.0');
    expect(ack.name).toBe('WCIES');
    expect(Number.isNaN(Date.parse(ack.time))).toBe(false);
    expect(ingest.ingestYandex).not.toHaveBeenCalled();
  });

  it('rejects sources outside the Yandex ranges with 403 before any parsing', async () => {
    const { controller, ingest, request } = makeController({ ip: OUT_OF_RANGE_IP });
    await expect(
      controller.receive('YX-A', { notificationType: 'ORDER_CREATED', orderId: 1 }, request),
    ).rejects.toMatchObject({ status: 403 });
    expect(ingest.ingestYandex).not.toHaveBeenCalled();
  });

  it('hands valid notifications to the ingest service and acks 200', async () => {
    const { controller, ingest, request } = makeController({});
    const ack = await controller.receive(
      'YX-A',
      { notificationType: 'ORDER_CREATED', campaignId: 1001, orderId: 5510001 },
      request,
    );
    expect(ack.version).toBe('1.0.0');
    expect(ingest.ingestYandex).toHaveBeenCalledWith('YX-A', {
      notificationType: 'ORDER_CREATED',
      campaignId: 1001,
      orderId: 5510001,
    });
  });

  it('maps malformed payloads (PLATFORM_BAD_RESPONSE) to 400', async () => {
    const { controller, request } = makeController({
      ingest: async () => {
        throw Object.assign(new Error('bad shape'), { code: 'PLATFORM_BAD_RESPONSE' });
      },
    });
    await expect(controller.receive('YX-A', { orderId: 1 }, request)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('still acks 200 on transient ingest failures (polling covers the data)', async () => {
    const { controller, request } = makeController({
      ingest: async () => {
        throw new Error('db hiccup');
      },
    });
    const ack = await controller.receive(
      'YX-A',
      { notificationType: 'ORDER_STATUS_UPDATED', orderId: 7 },
      request,
    );
    expect(ack.version).toBe('1.0.0');
  });

  it('honors the explicit allowlist bypass (local tunnel testing only)', async () => {
    const { controller, ingest, request } = makeController({
      ip: OUT_OF_RANGE_IP,
      allowDisabled: true,
    });
    await controller.receive('YX-A', { notificationType: 'PING' }, request);
    expect(ingest.ingestYandex).not.toHaveBeenCalled(); // PING stays inline, but no 403
  });
});
