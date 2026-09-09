import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PlatformWebhookEvent } from '@wcies/platform-contracts';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { PlatformService } from '../../platform/platform.service';
import { StoreService } from '../../store/services/store.service';
import { StoreNotFoundError } from '../../store/errors/store-errors';
import { PlatformAdapterRegistry } from '../../integration/platform-adapter.registry';
import { SyncContextService } from './sync-context.service';
import { OrderSyncService } from './order-sync.service';
import { ExternalRawEventRepository } from '../repositories/external-raw-event.repository';
import { webhookSellerId } from '../../integration/ozon/ozon.mapper';
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

    const stored = await this.rawEventRepo.insertIfNew({
      platform: 'OZON',
      storeId: store.id,
      eventType: event.eventType,
      externalEventId: event.externalEventId,
      payload: payload as Record<string, unknown>,
      status: 'PENDING',
    });
    if (stored === null) {
      return 'DUPLICATE';
    }
    // Persisted -> hand off to the worker; the HTTP request never waits for
    // platform reads or order ingestion (task §28).
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
    const platform = await this.platformService.getEntityByCode('OZON');
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

/**
 * Webhook background processing (BullMQ): re-reads authoritative data from
 * the platform API for NEW_POSTING hints and ingests through the standard
 * chain. Webhook and polling can race freely - ingestion idempotency by
 * (store_id, platform_order_id) keeps exactly one order (task §45/§52).
 */
@Injectable()
export class WebhookProcessService {
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

      for (const webhookEvent of events) {
        if (
          webhookEvent.eventType === 'NEW_POSTING' &&
          webhookEvent.platformOrderIds.length > 0 &&
          adapter.fetchOrdersByPlatformIds !== undefined
        ) {
          // Targeted re-read: the webhook only carries a posting number.
          const orders = await adapter.fetchOrdersByPlatformIds(
            context,
            webhookEvent.platformOrderIds,
          );
          await this.orderSyncService.ingestPlatformOrders(store.id, orders, 'WEBHOOK');
        } else {
          // PING / unknown types are recorded facts, not actions (§28/§29).
        }
      }
      await this.rawEventRepo.markStatus(event.id, 'SKIPPED');
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
