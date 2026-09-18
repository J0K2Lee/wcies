import { describe, expect, it, vi } from 'vitest';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { WebhookIngestService } from '../services/webhook.service';
import { WbWebhookReceiverController } from './wb-webhook.controller';

/**
 * WB webhook receiver unit tests: 401 on secret mismatch (surfaces in WB's
 * delivery log), 400 on malformed envelopes, 200 + status on success, and
 * the 200-ack fallback for transient failures (WB retries; idempotencyKey
 * dedup makes redelivery safe).
 */

const DELIVERY = {
  sellerId: 'seller-uuid',
  requestId: 'request-uuid',
  events: [
    {
      id: 'evt-1',
      type: 'card_changed',
      test: false,
      idempotencyKey: 'k1',
      payload: { nmID: 419929116 },
    },
  ],
};

function makeController(ingestImpl?: (...args: unknown[]) => Promise<string>) {
  const ingestWb = vi.fn(ingestImpl ?? (async () => 'ACCEPTED'));
  const logger = { warn: vi.fn(), error: vi.fn() } as unknown as AppLoggerService;
  const controller = new WbWebhookReceiverController(
    { ingestWb } as unknown as WebhookIngestService,
    logger,
  );
  return { controller, ingestWb };
}

describe('WbWebhookReceiverController', () => {
  it('answers 200 with the ingest status on a valid delivery', async () => {
    const { controller, ingestWb } = makeController();
    const body = await controller.receive('WB-A', 'one-time-secret', DELIVERY);
    expect(body).toEqual({ ok: true, status: 'ACCEPTED' });
    expect(ingestWb).toHaveBeenCalledWith('WB-A', DELIVERY, 'one-time-secret');
  });

  it('maps REJECTED (secret mismatch) to 401 before anything else happens', async () => {
    const { controller } = makeController(async () => 'REJECTED');
    await expect(controller.receive('WB-A', 'wrong-secret', DELIVERY)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('maps malformed envelopes (PLATFORM_BAD_RESPONSE) to 400', async () => {
    const { controller } = makeController(async () => {
      throw Object.assign(new Error('bad envelope'), { code: 'PLATFORM_BAD_RESPONSE' });
    });
    await expect(controller.receive('WB-A', 'secret', { nope: 1 })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rethrows unknown-store errors untouched', async () => {
    const { controller } = makeController(async () => {
      throw Object.assign(new Error('no store'), { code: 'STORE_NOT_FOUND' });
    });
    await expect(controller.receive('GHOST', 'secret', DELIVERY)).rejects.toMatchObject({
      code: 'STORE_NOT_FOUND',
    });
  });

  it('still acks 200 on transient failures (retry + dedup covers the data)', async () => {
    const { controller } = makeController(async () => {
      throw new Error('redis down');
    });
    await expect(controller.receive('WB-A', 'secret', DELIVERY)).resolves.toEqual({
      ok: true,
      status: 'ACCEPTED',
    });
  });

  it('treats a DUPLICATE redelivery as a 200 success', async () => {
    const { controller } = makeController(async () => 'DUPLICATE');
    await expect(controller.receive('WB-A', 'secret', DELIVERY)).resolves.toEqual({
      ok: true,
      status: 'DUPLICATE',
    });
  });
});
