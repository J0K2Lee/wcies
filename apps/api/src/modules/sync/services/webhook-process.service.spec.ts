import { describe, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { WebhookProcessService } from './webhook.service';
import { PlatformAdapterRegistry } from '../../integration/platform-adapter.registry';
import { SyncContextService } from './sync-context.service';
import { OrderSyncService } from './order-sync.service';
import { ExternalRawEventRepository } from '../repositories/external-raw-event.repository';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { PlatformOrderRaw } from '@wcies/platform-contracts';
import { mapWebhookPayload } from '../../integration/ozon/ozon.mapper';

/**
 * Dual-axis T2 acceptance (unit level):
 *
 * - TYPE_STATE_CHANGED / TYPE_POSTING_CANCELLED trigger the SAME targeted
 *   re-read + ingest chain as NEW_POSTING (posting-number hint only);
 * - the push-model payload vocabulary is never trusted - only the re-read
 *   answer flows into ingestion;
 * - the webhook event's changed_state_date is forwarded as the
 *   platform-side transition hint;
 * - raw-event status outcome: action types -> PROCESSED, no-action types
 *   (PING / ITEM_CHANGED / UNKNOWN) -> SKIPPED, processing errors -> FAILED;
 * - already-processed events are not reprocessed (duplicate delivery).
 */

interface RawEventRow {
  id: string;
  storeId: string;
  status: string;
  payload: Record<string, unknown>;
}

function buildService(input: {
  payload: Record<string, unknown>;
  adapterOrders?: PlatformOrderRaw[];
  fetchOrders?: OrderSyncService['ingestPlatformOrders'];
}) {
  const event: RawEventRow = {
    id: 're-1',
    storeId: 'store-1',
    status: 'PENDING',
    payload: input.payload,
  };
  const markStatus = vi.fn().mockResolvedValue(undefined);
  const rawEventRepo = {
    findById: vi.fn().mockResolvedValue(event),
    markStatus,
  } as unknown as ExternalRawEventRepository;
  const ingest = vi.fn().mockResolvedValue({ ingested: 1, duplicates: 0, failed: 0 });
  const ingestFn = input.fetchOrders !== undefined ? input.fetchOrders : ingest;
  const fetchOrdersByPlatformIds = vi.fn().mockResolvedValue(input.adapterOrders ?? []);
  const adapter = {
    processWebhook: vi.fn().mockImplementation((_ctx: unknown, payload: unknown) => {
      // Reuse the real OZON classification so eventType wiring is exercised.
      return Promise.resolve(mapWebhookPayload(payload));
    }),
    fetchOrdersByPlatformIds,
  };
  const service = new WebhookProcessService(
    { getAdapter: vi.fn().mockReturnValue(adapter) } as unknown as PlatformAdapterRegistry,
    {
      resolveSyncableStore: vi.fn().mockResolvedValue({
        store: { id: 'store-1' },
        adapter,
      }),
      buildStoreContext: vi.fn().mockResolvedValue({ storeId: 'store-1' }),
    } as unknown as SyncContextService,
    { ingestPlatformOrders: ingestFn } as unknown as OrderSyncService,
    rawEventRepo,
    {} as Queue,
    { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as AppLoggerService,
  );
  return { service, markStatus, ingest: ingestFn, fetchOrdersByPlatformIds };
}

describe('WebhookProcessService (dual-axis T2)', () => {
  it('TYPE_STATE_CHANGED triggers the targeted re-read + ingest with the event time hint', async () => {
    const changedStateDate = '2026-09-14T10:00:00.000Z';
    const { service, markStatus, ingest, fetchOrdersByPlatformIds } = buildService({
      payload: {
        message_type: 'TYPE_STATE_CHANGED',
        posting_number: '62081919-0389-1',
        new_state: 'posting_on_way_to_city',
        changed_state_date: changedStateDate,
        seller_id: 333000333,
      },
      adapterOrders: [
        {
          platformOrderId: '62081919-0389-1',
          platformStatus: 'delivering',
          platformStage: 'IN_TRANSIT',
          platformStageChangedAt: new Date(changedStateDate),
          fulfillmentMode: 'FBS',
          orderedAt: new Date(),
          shipmentDeadline: null,
          currency: null,
          items: [],
          rawData: {},
        },
      ],
    });
    await service.process('re-1');

    expect(fetchOrdersByPlatformIds).toHaveBeenCalledWith(expect.anything(), ['62081919-0389-1']);
    expect(ingest).toHaveBeenCalledWith(
      'store-1',
      expect.anything(),
      'WEBHOOK',
      expect.objectContaining({ platformChangedAt: new Date(changedStateDate) }),
    );
    expect(markStatus).toHaveBeenLastCalledWith('re-1', 'PROCESSED');
  });

  it('TYPE_POSTING_CANCELLED also acts (re-read chain), PROCESSED on success', async () => {
    const { service, markStatus, ingest } = buildService({
      payload: {
        message_type: 'TYPE_POSTING_CANCELLED',
        posting_number: 'P-CXL-1',
        new_state: 'posting_canceled',
        seller_id: 333000333,
      },
    });
    await service.process('re-1');
    expect(ingest).toHaveBeenCalledWith('store-1', [], 'WEBHOOK', expect.anything());
    expect(markStatus).toHaveBeenLastCalledWith('re-1', 'PROCESSED');
  });

  it('NEW_POSTING keeps acting (regression) and lands PROCESSED, not SKIPPED', async () => {
    const { service, markStatus, ingest } = buildService({
      payload: { message_type: 'TYPE_NEW_POSTING', posting_number: 'P-NEW-1' },
    });
    await service.process('re-1');
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(markStatus).toHaveBeenLastCalledWith('re-1', 'PROCESSED');
  });

  it.each([
    { message_type: 'TYPE_PING', time: '2026-09-14T10:00:00Z' },
    { message_type: 'TYPE_UPDATE_ITEM', item_id: 5 },
    { message_type: 'TYPE_WAT' },
  ])('no-action type %s lands SKIPPED with no re-read', async (payload) => {
    const { service, markStatus, ingest, fetchOrdersByPlatformIds } = buildService({ payload });
    await service.process('re-1');
    expect(fetchOrdersByPlatformIds).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
    expect(markStatus).toHaveBeenLastCalledWith('re-1', 'SKIPPED');
  });

  it('a processing error lands FAILED (never rethrown, queue stays healthy)', async () => {
    const failing = (): never => {
      throw Object.assign(new Error('platform unreachable'), { code: 'PLATFORM_TIMEOUT' });
    };
    const { service, markStatus } = buildService({
      payload: { message_type: 'TYPE_STATE_CHANGED', posting_number: 'P-X' },
      fetchOrders: failing,
    });
    await expect(service.process('re-1')).resolves.toBeUndefined();
    expect(markStatus).toHaveBeenLastCalledWith(
      're-1',
      'FAILED',
      expect.objectContaining({ errorCode: 'PLATFORM_TIMEOUT' }),
    );
  });

  it('skips an event that is no longer PENDING (duplicate delivery)', async () => {
    const markStatus = vi.fn().mockResolvedValue(undefined);
    const service = new WebhookProcessService(
      {} as unknown as PlatformAdapterRegistry,
      {} as unknown as SyncContextService,
      {} as unknown as OrderSyncService,
      {
        findById: vi.fn().mockResolvedValue({ id: 're-1', status: 'PROCESSED', payload: {} }),
        markStatus,
      } as unknown as ExternalRawEventRepository,
      {} as Queue,
      {} as unknown as AppLoggerService,
    );
    await service.process('re-1');
    expect(markStatus).not.toHaveBeenCalled();
  });
});
