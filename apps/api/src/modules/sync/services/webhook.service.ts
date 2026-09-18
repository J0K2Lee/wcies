import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PlatformWebhookEvent, PlatformWebhookEventType } from '@wcies/platform-contracts';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { PlatformService } from '../../platform/platform.service';
import { StoreService } from '../../store/services/store.service';
import { StoreNotFoundError } from '../../store/errors/store-errors';
import { PlatformAdapterRegistry } from '../../integration/platform-adapter.registry';
import { YandexAdapter } from '../../integration/yandex/yandex.adapter';
import {
  isWbTestWebhookEvent,
  isWbWebhookSecretValid,
  webhookEnvelopeSellerId,
} from '../../integration/wildberries/wb.mapper';
import { SyncContextService } from './sync-context.service';
import { OrderSyncService } from './order-sync.service';
import { ExternalRawEventRepository } from '../repositories/external-raw-event.repository';
import { PlatformCredentialService } from '../../store/services/platform-credential.service';
import { webhookChangedStateDate, webhookSellerId } from '../../integration/ozon/ozon.mapper';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { WebhookJobPayload } from '../sync.constants';

/**
 * OZON webhook ingestion (Sprint 5 task §26-§29).
 *
 * OZON push notifications carry NO signature (verified - see
 * docs/integrations/ozon.md). Identity assurance therefore comes from:
 * 1. the per-store URL segment (storeCode) configured in the OZON cabinet;
 * 2. seller_id in the payload matching the store credential's clientId;
 * 3. events being HINTS only - the processor re-reads the posting through
 *    the authenticated API before ingesting anything.
 *
 * HTTP path: verify shape -> persist raw event (hash dedup) -> enqueue ->
 * respond immediately. No order creation, no stock locking, no platform API
 * call inside the HTTP request (task §28).
 */
@Injectable()
export class WebhookIngestService {
  constructor(
    private readonly platformService: PlatformService,
    private readonly storeService: StoreService,
    private readonly registry: PlatformAdapterRegistry,
    private readonly contextService: SyncContextService,
    private readonly credentialService: PlatformCredentialService,
    private readonly rawEventRepo: ExternalRawEventRepository,
    @InjectQueue(QUEUE_NAMES.webhook) private readonly webhookQueue: Queue<WebhookJobPayload>,
    private readonly logger: AppLoggerService,
  ) {}

  async ingestOzon(
    storeCode: string,
    payload: unknown,
  ): Promise<'ACCEPTED' | 'DUPLICATE' | 'REJECTED'> {
    const store = await this.resolveOzonStore(storeCode);
    const adapter = this.registry.getAdapter('OZON');
    if (adapter.processWebhook === undefined) {
      throw new Error('OZON adapter does not support webhooks');
    }

    const context = await this.contextService.buildStoreContext(store);
    // Throws on malformed payloads (PLATFORM_BAD_RESPONSE) - HTTP 400.
    const events = await adapter.processWebhook(context, payload);
    const event = events[0];
    if (event === undefined) {
      throw new StoreNotFoundError(storeCode);
    }

    // Identity: payload seller_id must equal the credential clientId.
    const expectedSellerId = await this.contextService.credentialClientId(store.id);
    const claimedSellerId = webhookSellerId(payload);
    if (
      expectedSellerId !== null &&
      claimedSellerId !== null &&
      claimedSellerId !== expectedSellerId
    ) {
      await this.rawEventRepo.insertIfNew({
        platform: 'OZON',
        storeId: store.id,
        eventType: event.eventType,
        externalEventId: event.externalEventId,
        payload: payload as Record<string, unknown>,
        status: 'REJECTED',
      });
      this.logger.warn('ozon webhook rejected: seller_id mismatch', {
        module: 'sync',
        storeId: store.id,
      });
      return 'REJECTED';
    }

    return this.storeAndEnqueue('OZON', store.id, payload as Record<string, unknown>, event);
  }

  /**
   * Yandex Market webhook ingestion (2026-09-18, docs/integrations/yandex.md
   * §4). Yandex signs NOTHING - identity assurance is layered:
   * 1. source-IP allowlist (controller, before this method runs);
   * 2. payload campaignId must match the store's resolved campaign identity;
   * 3. events are HINTS only - the processor re-reads business orders via
   *    the authenticated API before ingesting anything.
   * PING never reaches this method (the controller answers it inline within
   * the platform's 1-second budget).
   */
  async ingestYandex(
    storeCode: string,
    payload: unknown,
  ): Promise<'ACCEPTED' | 'DUPLICATE' | 'REJECTED'> {
    const store = await this.resolveStoreByPlatform('YANDEX', storeCode);
    const adapter = this.registry.getAdapter('YANDEX');
    if (adapter.processWebhook === undefined) {
      throw new Error('YANDEX adapter does not support webhooks');
    }

    const context = await this.contextService.buildStoreContext(store);
    // Throws on malformed payloads (PLATFORM_BAD_RESPONSE) - HTTP 400.
    const events = await adapter.processWebhook(context, payload);
    const event = events[0];
    if (event === undefined) {
      throw new StoreNotFoundError(storeCode);
    }

    // Identity: a claimed campaignId must equal the store's campaign.
    const claimedCampaignId = readPayloadString(payload, 'campaignId');
    if (claimedCampaignId !== null) {
      const identity = await (adapter as YandexAdapter).resolveIdentityForContext(context);
      if (claimedCampaignId !== identity.campaignId) {
        await this.rawEventRepo.insertIfNew({
          platform: 'YANDEX',
          storeId: store.id,
          eventType: event.eventType,
          externalEventId: event.externalEventId,
          payload: payload as Record<string, unknown>,
          status: 'REJECTED',
        });
        this.logger.warn('yandex webhook rejected: campaignId mismatch', {
          module: 'sync',
          storeId: store.id,
        });
        return 'REJECTED';
      }
    }

    return this.storeAndEnqueue('YANDEX', store.id, payload as Record<string, unknown>, event);
  }

  /**
   * WB webhook 事件接收（2026-09-18，docs verified）。与 OZON/Yandex 的
   * 差异：WB 用创建 webhook 时一次性返回的 secret 验证入站推送 ——
   * Authorization 头必须等于店铺 WEBHOOK 凭证里的 secret（时序安全比较），
   * 这是唯一的真实性信号（平台不签名、无 IP 白名单要求）。
   * 一份投递可含最多 100 个事件；逐事件落库（externalEventId =
   * idempotencyKey ?? id，投递重试天然幂等），test:true 的探活事件落库为
   * SKIPPED 不入队（docs §Testing：不得当真实事件处理）。
   * 当前事件目录无订单事件：处理器对 ITEM_CHANGED/UNKNOWN 的既有行为就是
   * 记录事实不动作，与 OZON 链路一致。
   */
  async ingestWb(
    storeCode: string,
    payload: unknown,
    authorizationHeader: string | undefined,
  ): Promise<'ACCEPTED' | 'DUPLICATE' | 'REJECTED'> {
    const store = await this.resolveStoreByPlatform('WB', storeCode);
    const adapter = this.registry.getAdapter('WB');
    if (adapter.processWebhook === undefined) {
      throw new Error('WB adapter does not support webhooks');
    }

    // Authenticity: Authorization header == the store's WEBHOOK secret.
    const secretPayload = await this.credentialService.getDecryptedActivePayload(
      store.id,
      'WEBHOOK',
    );
    const expectedSecret =
      typeof secretPayload?.['secret'] === 'string' ? secretPayload['secret'] : null;
    if (!isWbWebhookSecretValid(authorizationHeader ?? null, expectedSecret)) {
      await this.rawEventRepo.insertIfNew({
        platform: 'WB',
        storeId: store.id,
        eventType: 'UNKNOWN',
        externalEventId: null,
        payload:
          typeof payload === 'object' && payload !== null
            ? (payload as Record<string, unknown>)
            : { payload: null },
        status: 'REJECTED',
      });
      this.logger.warn('wb webhook rejected: secret mismatch', {
        module: 'sync',
        storeId: store.id,
        claimedSellerId: webhookEnvelopeSellerId(payload),
      });
      return 'REJECTED';
    }

    const context = await this.contextService.buildStoreContext(store);
    // Throws on malformed payloads (PLATFORM_BAD_RESPONSE) - HTTP 400.
    const events = await adapter.processWebhook(context, payload);

    let accepted = 0;
    let duplicates = 0;
    let skipped = 0;
    for (const event of events) {
      const testEvent = isWbTestWebhookEvent(event);
      const stored = await this.rawEventRepo.insertIfNew({
        platform: 'WB',
        storeId: store.id,
        eventType: event.eventType,
        externalEventId: event.externalEventId,
        payload: event.payload,
        status: testEvent ? 'SKIPPED' : 'PENDING',
      });
      if (stored === null) {
        duplicates += 1;
        continue;
      }
      if (testEvent) {
        skipped += 1; // recorded for audit, never processed as real (docs §Testing)
        continue;
      }
      await this.webhookQueue.add(
        'process',
        { rawEventId: stored.id },
        {
          attempts: 1,
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 24 * 3600 },
          jobId: `rawevent-${stored.id}`,
        },
      );
      accepted += 1;
    }
    this.logger.info('wb webhook delivery ingested', {
      module: 'sync',
      storeId: store.id,
      accepted,
      duplicates,
      skipped,
    });
    return accepted === 0 && duplicates > 0 ? 'DUPLICATE' : 'ACCEPTED';
  }

  /** Persist the raw event (hash dedup) and hand off to the worker. */
  private async storeAndEnqueue(
    platform: string,
    storeId: string,
    payload: Record<string, unknown>,
    event: PlatformWebhookEvent,
  ): Promise<'ACCEPTED' | 'DUPLICATE'> {
    const stored = await this.rawEventRepo.insertIfNew({
      platform,
      storeId,
      eventType: event.eventType,
      externalEventId: event.externalEventId,
      payload,
      status: 'PENDING',
    });
    if (stored === null) {
      return 'DUPLICATE';
    }
    // Persisted -> hand off to the worker; the HTTP request never waits for
    // platform reads or order ingestion (AGENTS.md §47).
    await this.webhookQueue.add(
      'process',
      { rawEventId: stored.id },
      {
        attempts: 1,
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 24 * 3600 },
        jobId: `rawevent-${stored.id}`,
      },
    );
    return 'ACCEPTED';
  }

  private async resolveOzonStore(
    storeCode: string,
  ): Promise<NonNullable<Awaited<ReturnType<StoreService['getEntityById']>>>> {
    return this.resolveStoreByPlatform('OZON', storeCode);
  }

  private async resolveStoreByPlatform(
    platformCode: 'OZON' | 'YANDEX' | 'WB',
    storeCode: string,
  ): Promise<NonNullable<Awaited<ReturnType<StoreService['getEntityById']>>>> {
    const platform = await this.platformService.getEntityByCode(platformCode);
    if (platform === null) {
      throw new StoreNotFoundError(storeCode);
    }
    const store = await this.storeService.getEntityByPlatformAndCode(platform.id, storeCode);
    if (store === null) {
      throw new StoreNotFoundError(storeCode);
    }
    return store;
  }
}

function readPayloadString(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * Webhook background processing (BullMQ): re-reads authoritative data from
 * the platform API and ingests through the standard chain. Webhook and
 * polling can race freely - ingestion idempotency by
 * (store_id, platform_order_id) keeps exactly one order (task §45/§52).
 *
 * Dual-axis T2 (2026-09-15): the action set grew from NEW_POSTING to all
 * posting-hint types - TYPE_STATE_CHANGED and TYPE_POSTING_CANCELLED also
 * carry `posting_number` (docs/integrations/ozon.md §6.1), so the same
 * targeted re-read applies. The push-model status vocabulary in the payload
 * is NEVER trusted into platform_status (§6.2) - only the re-read Seller API
 * answer is. Unknown posting numbers still ingest fully (a webhook IS a
 * catch-up channel; ingestion idempotency makes this safe). Event status:
 * action types end PROCESSED, failures FAILED, no-action types (PING /
 * ITEM_CHANGED / UNKNOWN) SKIPPED.
 */
@Injectable()
export class WebhookProcessService {
  /** Event types that trigger the targeted re-read action. */
  private static readonly ACTION_TYPES = new Set<PlatformWebhookEventType>([
    'NEW_POSTING',
    'POSTING_STATE_CHANGED',
    'POSTING_CANCELLED',
  ]);

  constructor(
    private readonly registry: PlatformAdapterRegistry,
    private readonly contextService: SyncContextService,
    private readonly orderSyncService: OrderSyncService,
    private readonly rawEventRepo: ExternalRawEventRepository,
    @InjectQueue(QUEUE_NAMES.webhook) private readonly webhookQueue: Queue<WebhookJobPayload>,
    private readonly logger: AppLoggerService,
  ) {}

  async process(rawEventId: string): Promise<void> {
    const event = await this.rawEventRepo.findById(rawEventId);
    if (event === null || event.status !== 'PENDING') {
      return; // duplicate delivery or already processed
    }
    await this.rawEventRepo.markStatus(event.id, 'PROCESSING');

    try {
      const { store, adapter } = await this.contextService.resolveSyncableStore(event.storeId);
      const context = await this.contextService.buildStoreContext(store);
      const parsed = await adapter.processWebhook?.(context, event.payload);
      const events: PlatformWebhookEvent[] = parsed ?? [];

      let acted = false;
      for (const webhookEvent of events) {
        if (
          WebhookProcessService.ACTION_TYPES.has(webhookEvent.eventType) &&
          webhookEvent.platformOrderIds.length > 0 &&
          adapter.fetchOrdersByPlatformIds !== undefined
        ) {
          // Targeted re-read: the webhook only carries a posting number and
          // (for state events) the platform-side changed_state_date hint.
          const orders = await adapter.fetchOrdersByPlatformIds(
            context,
            webhookEvent.platformOrderIds,
          );
          await this.orderSyncService.ingestPlatformOrders(store.id, orders, 'WEBHOOK', {
            platformChangedAt: webhookChangedStateDate(webhookEvent.payload),
          });
          acted = true;
        } else {
          // PING / ITEM_CHANGED / UNKNOWN types are recorded facts, not
          // actions (§28/§29) - listing changes flow through manual sync.
        }
      }
      await this.rawEventRepo.markStatus(event.id, acted ? 'PROCESSED' : 'SKIPPED');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.rawEventRepo.markStatus(event.id, 'FAILED', {
        errorCode:
          typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'WEBHOOK_PROCESS_ERROR',
        errorMessage: message.slice(0, 2000),
      });
      // Never rethrow: a failing webhook must not poison the queue; the
      // polling catch-up covers the data.
      this.logger.error(`webhook processing failed: ${message}`, undefined, {
        module: 'sync',
        rawEventId: event.id,
      });
    }
  }
}
