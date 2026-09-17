import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue.constants';
import { IntegrationModule } from '../integration/integration.module';
import { OzonModule } from '../integration/ozon/ozon.module';
import { YandexModule } from '../integration/yandex/yandex.module';
import { ListingModule } from '../listing/listing.module';
import { OrderModule } from '../order/order.module';
import { PlatformModule } from '../platform/platform.module';
import { StoreModule } from '../store/store.module';
import { ExceptionModule } from '../exception/exception.module';
import { ExternalRawEventEntity } from './entities/external-raw-event.entity';
import { SyncCursorEntity } from './entities/sync-cursor.entity';
import { SyncJobEntity } from './entities/sync-job.entity';
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
import { PlatformWarehouseQueryService } from './services/platform-warehouse-query.service';
import { SyncController } from './controllers/sync.controller';
import { OzonWebhookController } from './controllers/ozon-webhook.controller';
import { YandexWebhookController } from './controllers/yandex-webhook.controller';
import { PlatformWarehouseController } from './controllers/platform-warehouse.controller';
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
    YandexModule,
    StoreModule,
    PlatformModule,
    ListingModule,
    OrderModule,
    ExceptionModule,
  ],
  controllers: [
    SyncController,
    OzonWebhookController,
    YandexWebhookController,
    PlatformWarehouseController,
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
    ListingSyncService,
    OrderSyncService,
    CategoryTreeSyncService,
    ProductEnrichmentSyncService,
    WebhookIngestService,
    WebhookProcessService,
    OrderSyncProcessor,
    ListingSyncProcessor,
    CategoryTreeSyncProcessor,
    ProductEnrichmentSyncProcessor,
    WebhookProcessor,
    SyncSchedulerProcessor,
  ],
  exports: [SyncJobService, SyncDispatchService, SyncContextService],
})
export class SyncModule {}
