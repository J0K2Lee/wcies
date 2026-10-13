import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue.constants';
import { IntegrationModule } from '../integration/integration.module';
import { OzonModule } from '../integration/ozon/ozon.module';
import { WildberriesModule } from '../integration/wildberries/wb.module';
import { YandexModule } from '../integration/yandex/yandex.module';
import { ListingModule } from '../listing/listing.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { OrderModule } from '../order/order.module';
import { PlatformModule } from '../platform/platform.module';
import { StoreModule } from '../store/store.module';
import { ExceptionModule } from '../exception/exception.module';
import { ExternalRawEventEntity } from './entities/external-raw-event.entity';
import { SyncCursorEntity } from './entities/sync-cursor.entity';
import { SyncJobEntity } from './entities/sync-job.entity';
import { ShipmentModule } from '../shipment/shipment.module';
import { ExternalRawEventRepository } from './repositories/external-raw-event.repository';
import { SyncCursorRepository } from './repositories/sync-cursor.repository';
import { SyncJobRepository } from './repositories/sync-job.repository';
import { CategoryTreeSyncService } from './services/category-tree-sync.service';
import { ListingSyncService } from './services/listing-sync.service';
import { ProductEnrichmentSyncService } from './services/product-enrichment-sync.service';
import { OrderSyncService } from './services/order-sync.service';
import { SyncContextService } from './services/sync-context.service';
import { SyncDispatchService } from './services/sync-dispatch.service';
import { SyncFailureAlertService } from './services/sync-failure-alert.service';
import { SyncJobService } from './services/sync-job.service';
import { WebhookIngestService, WebhookProcessService } from './services/webhook.service';
import { WbWebhookService } from './services/wb-webhook.service';
import { OzonWebhookService } from './services/ozon-webhook.service';
import { PlatformWarehouseQueryService } from './services/platform-warehouse-query.service';
import { OrderPlatformShipService } from './services/order-platform-ship.service';
import { SyncController } from './controllers/sync.controller';
import {
  OzonWebhookController,
  OzonWebhookManageController,
} from './controllers/ozon-webhook.controller';
import { YandexWebhookController } from './controllers/yandex-webhook.controller';
import {
  WbWebhookManageController,
  WbWebhookReceiverController,
} from './controllers/wb-webhook.controller';
import { PlatformWarehouseController } from './controllers/platform-warehouse.controller';
import { OrderFulfillmentController } from './controllers/order-fulfillment.controller';
import {
  CategoryTreeSyncProcessor,
  ListingSyncProcessor,
  OrderSyncProcessor,
  ProductEnrichmentSyncProcessor,
} from './processors/sync.processors';
import {
  SyncSchedulerProcessor,
  WebhookProcessor,
} from './processors/webhook-scheduler.processors';

/**
 * Sync engine (Sprint 5 task §10): LISTING_SYNC + ORDER_SYNC, per-store
 * isolated, single-flight guarded, BullMQ driven.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SyncJobEntity, SyncCursorEntity, ExternalRawEventEntity]),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.orderSync },
      { name: QUEUE_NAMES.listingSync },
      { name: QUEUE_NAMES.webhook },
      { name: QUEUE_NAMES.scheduler },
      { name: QUEUE_NAMES.categoryTree },
      { name: QUEUE_NAMES.enrichment },
    ),
    IntegrationModule,
    OzonModule,
    WildberriesModule,
    YandexModule,
    StoreModule,
    PlatformModule,
    ListingModule,
    OrderModule,
    // Order fulfillment flow (2026-09-18): the sync layer orchestrates the
    // platform steps and calls the shipment module's public one-click outbound
    // service. ShipmentModule never imports SyncModule, so no cycle.
    ShipmentModule,
    ExceptionModule,
    OperationLogModule,
  ],
  controllers: [
    SyncController,
    OzonWebhookController,
    OzonWebhookManageController,
    YandexWebhookController,
    WbWebhookReceiverController,
    WbWebhookManageController,
    PlatformWarehouseController,
    OrderFulfillmentController,
  ],
  providers: [
    SyncJobRepository,
    SyncCursorRepository,
    ExternalRawEventRepository,
    SyncContextService,
    SyncDispatchService,
    SyncFailureAlertService,
    SyncJobService,
    PlatformWarehouseQueryService,
    OrderPlatformShipService,
    ListingSyncService,
    OrderSyncService,
    CategoryTreeSyncService,
    ProductEnrichmentSyncService,
    WebhookIngestService,
    WebhookProcessService,
    WbWebhookService,
    OzonWebhookService,
    OrderSyncProcessor,
    ListingSyncProcessor,
    CategoryTreeSyncProcessor,
    ProductEnrichmentSyncProcessor,
    WebhookProcessor,
    SyncSchedulerProcessor,
  ],
  exports: [SyncJobService, SyncDispatchService, SyncContextService],
})
export class SyncModule implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_NAMES.scheduler) private readonly schedulerQueue: Queue) {}

  /**
   * Registers the sync scheduler tick (every 30s). Lives HERE, not only in
   * the standalone worker: dev compose runs the API without a worker
   * container, and a worker-only registration silently disabled auto-sync
   * even with ENV interval + store toggle both on (diagnosed 2026-10-12,
   * ON-003: zero SCHEDULED jobs ever). BullMQ dedupes the repeatable job
   * by jobId, so API + worker both booting is safe. Frequencies are read
   * from ENV per tick (ORDER_SYNC_INTERVAL_SECONDS /
   * LISTING_SYNC_INTERVAL_SECONDS, default OFF) and a store still has to
   * opt in via settings.sync (task §30/§57 staged rollout).
   */
  async onModuleInit(): Promise<void> {
    await this.schedulerQueue.add(
      'tick',
      {},
      {
        repeat: { every: 30_000 },
        jobId: 'sync-scheduler-tick',
        removeOnComplete: { count: 4 },
        removeOnFail: { count: 10 },
      },
    );
  }
}
