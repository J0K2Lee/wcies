import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { PlatformCredentialService } from '../../store/services/platform-credential.service';
import { WbClient, WbWebhookAuth } from '../../integration/wildberries/wb.client';
import { SyncContextService } from './sync-context.service';
import { WbWebhookService, WbWebhookConfigError, WbWebhookStateError } from './wb-webhook.service';

/**
 * WbWebhookService unit tests: subscription idempotency, the one-time
 * secret persistence (WEBHOOK credential), config-gap errors and the
 * delete-by-exact-URL unsubscribe rule (never a blind delete).
 */

const OPERATOR: OperatorContext = { userId: 'u1', username: 'tester' };
const WEBHOOK_ID = 'wh-1';
const SECRET = 'one-time-secret-abc';
const URL = 'https://hook.example.com/api/v1/webhooks/wb/stores/WB-A';

function makeService(options?: {
  existing?: Array<Record<string, unknown>>;
  localSecret?: Record<string, unknown> | null;
  credentialId?: string | null;
  publicBaseUrl?: string;
  serviceSecret?: string;
  createResponse?: Record<string, unknown>;
}) {
  const listWebhooks = vi.fn(async () => options?.existing ?? []);
  const createWebhook = vi.fn(
    async () => options?.createResponse ?? { id: WEBHOOK_ID, secret: SECRET, enabled: true },
  );
  const deleteWebhook = vi.fn(async () => undefined);
  const client = { listWebhooks, createWebhook, deleteWebhook } as unknown as WbClient;

  const store = { id: 'store-1', storeCode: 'WB-A', platformId: 'p1', status: 'ACTIVE' };
  const syncContext = {
    resolveSyncableStore: vi.fn(async () => ({
      store,
      adapter: { platformCode: 'WB' },
    })),
    buildStoreContext: vi.fn(async () => ({
      storeId: store.id,
      storeCode: store.storeCode,
      platform: 'WB' as const,
      credential: { apiKey: 'seller-token' },
    })),
  } as unknown as SyncContextService;

  const credentialService = {
    getDecryptedActivePayload: vi.fn(async (_storeId: string, type: string) =>
      type === 'WEBHOOK' ? (options?.localSecret ?? null) : { apiKey: 'seller-token' },
    ),
    getValidationMeta: vi.fn(async () =>
      options?.credentialId === undefined
        ? null
        : { credentialId: options.credentialId, configured: true },
    ),
    create: vi.fn(async () => ({})),
    updatePayload: vi.fn(async () => ({})),
  } as unknown as PlatformCredentialService;

  const operationLog = { record: vi.fn(async () => undefined) } as unknown as OperationLogService;
  const config = {
    get: vi.fn((key: string) => {
      // `in` checks (not ??) so an explicitly-passed undefined/'' IS honored
      // as the configured value - that's exactly what the config-gap tests
      // exercise.
      if (key === 'app.publicBaseUrl') {
        return options !== undefined && 'publicBaseUrl' in options
          ? options.publicBaseUrl
          : 'https://hook.example.com/';
      }
      if (key === 'WB_WEBHOOKS_SERVICE_SECRET') {
        return options !== undefined && 'serviceSecret' in options
          ? options.serviceSecret
          : 'service-secret';
      }
      return undefined;
    }),
  } as unknown as ConfigService;

  const service = new WbWebhookService(
    syncContext,
    credentialService,
    operationLog,
    client,
    config,
  );
  return { service, listWebhooks, createWebhook, deleteWebhook, credentialService, operationLog };
}

describe('WbWebhookService.subscribe', () => {
  it('creates the webhook and persists the one-time secret as a WEBHOOK credential', async () => {
    const { service, createWebhook, credentialService, operationLog } = makeService();
    const view = await service.subscribe('store-1', OPERATOR);

    expect(createWebhook).toHaveBeenCalledTimes(1);
    const [auth, , body] = createWebhook.mock.calls[0] as unknown as [
      WbWebhookAuth,
      string,
      { url: string; name: string; subscriptions: unknown[] },
    ];
    expect(auth).toEqual({ apiKey: 'seller-token', serviceSecret: 'service-secret' });
    expect(body.url).toBe(URL);
    expect(body.name).toBe('WCIES WB-A');
    expect(body.subscriptions).toEqual([
      { scope: 'content', event: 'card_changed' },
      { scope: 'content', event: 'card_creation_error' },
    ]);
    expect(credentialService.create).toHaveBeenCalledWith(
      'store-1',
      { credentialType: 'WEBHOOK', payload: { secret: SECRET } },
      OPERATOR,
    );
    expect(operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUBSCRIBE', entityCode: 'WB-A' }),
    );
    expect(view).toMatchObject({ subscribed: true, webhookId: WEBHOOK_ID, secretConfigured: true });
  });

  it('replaces an existing WEBHOOK credential instead of duplicating it', async () => {
    const { service, credentialService } = makeService({ credentialId: 'cred-9' });
    await service.subscribe('store-1', OPERATOR);
    expect(credentialService.updatePayload).toHaveBeenCalledWith(
      'store-1',
      'cred-9',
      { secret: SECRET },
      OPERATOR,
    );
    expect(credentialService.create).not.toHaveBeenCalled();
  });

  it('is idempotent when the webhook already exists and the secret is stored locally', async () => {
    const { service, createWebhook } = makeService({
      existing: [{ id: WEBHOOK_ID, url: URL, enabled: true }],
      localSecret: { secret: SECRET },
    });
    const view = await service.subscribe('store-1', OPERATOR);
    expect(createWebhook).not.toHaveBeenCalled();
    expect(view).toMatchObject({ subscribed: true, webhookId: WEBHOOK_ID, secretConfigured: true });
  });

  it('refuses to double-subscribe when the one-time secret is lost locally', async () => {
    const { service, createWebhook } = makeService({
      existing: [{ id: WEBHOOK_ID, url: URL }],
      localSecret: null,
    });
    await expect(service.subscribe('store-1', OPERATOR)).rejects.toMatchObject({
      code: 'WB_WEBHOOK_STATE_ERROR',
    });
    expect(createWebhook).not.toHaveBeenCalled();
  });

  it('fails loudly when the creation response hides the secret (T0 shape)', async () => {
    const { service, credentialService } = makeService({
      createResponse: { id: WEBHOOK_ID, enabled: true },
    });
    await expect(service.subscribe('store-1', OPERATOR)).rejects.toMatchObject({
      code: 'WB_WEBHOOK_STATE_ERROR',
    });
    expect(credentialService.create).not.toHaveBeenCalled();
  });

  it('requires PUBLIC_BASE_URL and the service secret', async () => {
    const noBase = makeService({ publicBaseUrl: undefined });
    await expect(noBase.service.subscribe('store-1', OPERATOR)).rejects.toMatchObject({
      code: 'WB_WEBHOOK_CONFIG_ERROR',
    });
    const noSecret = makeService({ serviceSecret: '' });
    await expect(noSecret.service.subscribe('store-1', OPERATOR)).rejects.toBeInstanceOf(
      WbWebhookConfigError,
    );
  });
});

describe('WbWebhookService.unsubscribe', () => {
  it('deletes the webhook matched by EXACT callback URL', async () => {
    const { service, deleteWebhook, operationLog } = makeService({
      existing: [
        { id: WEBHOOK_ID, url: URL },
        { id: 'wh-other', url: 'https://other.example.com/hook' },
      ],
    });
    const result = await service.unsubscribe('store-1', OPERATOR);
    expect(deleteWebhook).toHaveBeenCalledWith(expect.anything(), 'store-1', WEBHOOK_ID);
    expect(result).toEqual({ deleted: 1, url: URL });
    expect(operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UNSUBSCRIBE' }),
    );
  });

  it('treats no match as an idempotent no-op', async () => {
    const { service, deleteWebhook } = makeService({ existing: [] });
    await expect(service.unsubscribe('store-1', OPERATOR)).resolves.toEqual({
      deleted: 0,
      url: URL,
    });
    expect(deleteWebhook).not.toHaveBeenCalled();
  });

  it('refuses a blind delete when several webhooks share the URL', async () => {
    const { service, deleteWebhook } = makeService({
      existing: [
        { id: 'wh-1', url: URL },
        { id: 'wh-2', url: URL },
      ],
    });
    await expect(service.unsubscribe('store-1', OPERATOR)).rejects.toBeInstanceOf(
      WbWebhookStateError,
    );
    expect(deleteWebhook).not.toHaveBeenCalled();
  });
});

describe('WbWebhookService.getStatus', () => {
  it('reports subscribed state with secretConfigured and subscription rows', async () => {
    const { service } = makeService({
      existing: [
        {
          id: WEBHOOK_ID,
          url: URL,
          enabled: true,
          subscriptions: [{ scope: 'content', event: 'card_changed' }],
        },
      ],
      localSecret: { secret: SECRET },
    });
    await expect(service.getStatus('store-1')).resolves.toMatchObject({
      subscribed: true,
      webhookId: WEBHOOK_ID,
      enabled: true,
      secretConfigured: true,
      subscriptions: [{ scope: 'content', event: 'card_changed' }],
    });
  });

  it('reports unsubscribed with the callback URL for reference', async () => {
    const { service } = makeService({ existing: [] });
    await expect(service.getStatus('store-1')).resolves.toMatchObject({
      subscribed: false,
      url: URL,
      secretConfigured: false,
    });
  });
});
