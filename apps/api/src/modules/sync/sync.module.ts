import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUE_NAMES } from '../../infrastructure/queue/queue.constants';
import { IntegrationModule } from '../integration/integration.module';
import { ListingModule } from '../listing/listing.module';
import { OrderModule } from '../order/order.module';
import { PlatformModule } from '../platform/platform.module';
import { StoreModule } from '../store/store.module';
import { ExternalRawEventEntity } from './entities/external-raw-event.entity';
import { SyncCursorEntity } from './entities/sync-cursor.entity';
import { SyncJobEntity } from './entities/sync-job.entity';
import { ExternalRawEventRepository } from './repositories/external-raw-event.repository';
import { SyncCursorRepository } from './repositories/sync-cursor.repository';
import { SyncJobRepository } from './repositories/sync-job.repository';
import { ListingSyncService } from './services/listing-sync.service';
import { OrderSyncService } from './services/order-sync.service';
import { SyncContextService } from './services/sync-context.service';
import { SyncDispatchService } from './services/sync-dispatch.service';
import { SyncJobService } from './services/sync-job.service';
import { WebhookIngestService, WebhookProcessService } from './services/webhook.service';
import { SyncController } from './controllers/sync.controller';
import { OzonWebhookController } from './controllers/ozon-webhook.controller';
import { ListingSyncProcessor, OrderSyncProcessor } from './processors/sync.processors';
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
    ),
    IntegrationModule,
    StoreModule,
    PlatformModule,
    ListingModule,
    OrderModule,
  ],
  controllers: [SyncController, OzonWebhookController],
  providers: [
    SyncJobRepository,
    SyncCursorRepository,
    ExternalRawEventRepository,
    SyncContextService,
    SyncDispatchService,
    SyncJobService,
    ListingSyncService,
    OrderSyncService,
    WebhookIngestService,
    WebhookProcessService,
    OrderSyncProcessor,
    ListingSyncProcessor,
    WebhookProcessor,
    SyncSchedulerProcessor,
  ],
  exports: [SyncJobService, SyncDispatchService, SyncContextService],
})
export class SyncModule {}
