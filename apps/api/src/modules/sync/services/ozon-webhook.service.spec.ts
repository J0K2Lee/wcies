import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { OzonClient } from '../../integration/ozon/ozon.client';
import { PlatformApiError } from '../../integration/platform-error';
import { SyncContextService } from './sync-context.service';
import {
  OzonWebhookConfigError,
  OzonWebhookStateError,
  OZON_WEBHOOK_EVENT_TYPES,
  OzonWebhookService,
} from './ozon-webhook.service';

/**
 * OzonWebhookService unit tests: exact-URL matching against the account-wide
 * subscription list, set-vs-update branching, the auto-pause re-enable, and
 * the never-touch-other-subscriptions delete rule.
 */

const OPERATOR: OperatorContext = { userId: 'u1', username: 'tester' };
const URL = 'https://hook.example.com/api/v1/webhooks/ozon/stores/ON-001';
const OTHER_URL = 'https://other-system.example.com/hook';

function makeService(options?: {
  existing?: Array<Record<string, unknown>>;
  publicBaseUrl?: string;
  platformCode?: string;
}) {
  const notificationList = vi.fn(async () => ({ urls: (options?.existing ?? []) as never }));
  const notificationSet = vi.fn(async () => undefined);
  const notificationUpdate = vi.fn(async () => undefined);
  const notificationEnable = vi.fn(async () => undefined);
  const notificationDelete = vi.fn(async () => undefined);
  const client = {
    notificationList,
    notificationSet,
    notificationUpdate,
    notificationEnable,
    notificationDelete,
  } as unknown as OzonClient;

  const store = { id: 'store-1', storeCode: 'ON-001', platformId: 'p1', status: 'ACTIVE' };
  const syncContext = {
    resolveSyncableStore: vi.fn(async () => ({
      store,
      adapter: { platformCode: options?.platformCode ?? 'OZON' },
    })),
    buildStoreContext: vi.fn(async () => ({
      storeId: store.id,
      storeCode: store.storeCode,
      platform: 'OZON' as const,
      credential: { clientId: '12345', apiKey: 'ozon-key' },
    })),
  } as unknown as SyncContextService;

  const operationLog = { record: vi.fn(async () => undefined) } as unknown as OperationLogService;
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'app.publicBaseUrl') {
        return options !== undefined && 'publicBaseUrl' in options
          ? options.publicBaseUrl
          : 'https://hook.example.com';
      }
      return undefined;
    }),
  } as unknown as ConfigService;

  const service = new OzonWebhookService(syncContext, operationLog, client, config);
  return {
    service,
    notificationList,
    notificationSet,
    notificationUpdate,
    notificationEnable,
    notificationDelete,
    operationLog,
  };
}

describe('OzonWebhookService.getStatus', () => {
  it('reports subscribed state with types and other-URL count', async () => {
    const { service } = makeService({
      existing: [
        {
          id: 7,
          url: URL,
          enable: true,
          types: [{ type: 'TYPE_NEW_POSTING', description: 'Новое отправление' }],
        },
        {
          id: 8,
          url: OTHER_URL,
          enable: true,
          types: [{ type: 'TYPE_STOCKS_CHANGED', description: '' }],
        },
      ],
    });
    // T0 (2026-10-12): list response `types` items are {type, description}
    // objects, not plain strings - the view must surface string types only.
    const view = await service.getStatus('store-1');
    expect(view).toMatchObject({
      subscribed: true,
      subscriptionId: 7,
      enabled: true,
      types: ['TYPE_NEW_POSTING'],
      otherUrlCount: 1,
    });
    expect(view.expectedTypes).toEqual([...OZON_WEBHOOK_EVENT_TYPES]);
  });

  it('still tolerates legacy plain-string type entries', async () => {
    const { service } = makeService({
      existing: [{ id: 7, url: URL, enable: true, types: ['TYPE_NEW_POSTING'] }],
    });
    const view = await service.getStatus('store-1');
    expect(view.types).toEqual(['TYPE_NEW_POSTING']);
  });

  it('reports unsubscribed when the account list has no matching URL', async () => {
    const { service } = makeService({
      existing: [{ id: 8, url: OTHER_URL, enable: true, types: [] }],
    });
    const view = await service.getStatus('store-1');
    expect(view).toMatchObject({ subscribed: false, subscriptionId: null, otherUrlCount: 1 });
  });

  it('refuses to guess when the platform returns duplicate URLs', async () => {
    const { service } = makeService({
      existing: [
        { id: 7, url: URL, enable: true, types: [] },
        { id: 9, url: URL, enable: false, types: [] },
      ],
    });
    await expect(service.getStatus('store-1')).rejects.toBeInstanceOf(OzonWebhookStateError);
  });
});

describe('OzonWebhookService.subscribe', () => {
  it('creates a new subscription with the recommended event types', async () => {
    const { service, notificationSet, notificationUpdate, operationLog } = makeService();
    await service.subscribe('store-1', OPERATOR);

    expect(notificationSet).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: '12345', apiKey: 'ozon-key' }),
      'store-1',
      { url: URL, types: [...OZON_WEBHOOK_EVENT_TYPES] },
    );
    expect(notificationUpdate).not.toHaveBeenCalled();
    expect(operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUBSCRIBE', entityCode: 'ON-001' }),
    );
  });

  it('aligns types via update when the URL is already subscribed, and re-enables a paused subscription', async () => {
    const { service, notificationSet, notificationUpdate, notificationEnable } = makeService({
      existing: [{ id: 7, url: URL, enable: false, types: ['TYPE_NEW_POSTING'] }],
    });
    await service.subscribe('store-1', OPERATOR);
    expect(notificationSet).not.toHaveBeenCalled();
    expect(notificationUpdate).toHaveBeenCalledWith(expect.anything(), 'store-1', {
      id: 7,
      types: [...OZON_WEBHOOK_EVENT_TYPES],
    });
    expect(notificationEnable).toHaveBeenCalledWith(expect.anything(), 'store-1', {
      id: 7,
      enabled: true,
    });
  });

  it('requires an OZON store and PUBLIC_BASE_URL', async () => {
    const wrongPlatform = makeService({ platformCode: 'WB' });
    await expect(wrongPlatform.service.subscribe('store-1', OPERATOR)).rejects.toBeInstanceOf(
      OzonWebhookConfigError,
    );
    const noBase = makeService({ publicBaseUrl: undefined });
    await expect(noBase.service.subscribe('store-1', OPERATOR)).rejects.toMatchObject({
      code: 'OZON_WEBHOOK_CONFIG_ERROR',
    });
  });

  it('translates the set-time PING connectivity failure into actionable guidance (2026-10-12 T0)', async () => {
    const { service, notificationSet } = makeService();
    (notificationSet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new PlatformApiError({
        code: 'PLATFORM_API_ERROR',
        message: 'OZON error 3: PING: REQUEST_ERROR',
        httpStatus: 400,
        requestId: null,
        endpoint: '/v1/notification/set',
        storeId: 'store-1',
      }),
    );
    await expect(service.subscribe('store-1', OPERATOR)).rejects.toMatchObject({
      code: 'OZON_WEBHOOK_CONFIG_ERROR',
      message: expect.stringContaining('连通性检查未通过'),
    });
  });

  it('lets non-PING platform errors pass through untranslated', async () => {
    const { service, notificationSet } = makeService();
    const quotaError = new PlatformApiError({
      code: 'PLATFORM_RATE_LIMITED',
      message: 'Rate limited by OZON',
      httpStatus: 429,
      requestId: null,
      endpoint: '/v1/notification/set',
      storeId: 'store-1',
    });
    (notificationSet as ReturnType<typeof vi.fn>).mockRejectedValueOnce(quotaError);
    await expect(service.subscribe('store-1', OPERATOR)).rejects.toBe(quotaError);
  });
});

describe('OzonWebhookService.unsubscribe', () => {
  it('deletes ONLY the subscription matching the exact callback URL', async () => {
    const { service, notificationDelete, operationLog } = makeService({
      existing: [
        { id: 7, url: URL, enable: true, types: [] },
        { id: 8, url: OTHER_URL, enable: true, types: [] },
      ],
    });
    const result = await service.unsubscribe('store-1', OPERATOR);
    expect(notificationDelete).toHaveBeenCalledWith(expect.anything(), 'store-1', { id: 7 });
    expect(result).toEqual({ deleted: 1, url: URL });
    expect(operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UNSUBSCRIBE' }),
    );
  });

  it('treats no match as an idempotent no-op', async () => {
    const { service, notificationDelete } = makeService({ existing: [] });
    await expect(service.unsubscribe('store-1', OPERATOR)).resolves.toEqual({
      deleted: 0,
      url: URL,
    });
    expect(notificationDelete).not.toHaveBeenCalled();
  });
});
