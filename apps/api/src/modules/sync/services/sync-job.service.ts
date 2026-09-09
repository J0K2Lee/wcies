import { Injectable } from '@nestjs/common';
import { PlatformCredentialService } from '../../store/services/platform-credential.service';
import { StoreService } from '../../store/services/store.service';
import { StoreNotFoundError } from '../../store/errors/store-errors';
import { PlatformService } from '../../platform/platform.service';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { SyncCursorRepository } from '../repositories/sync-cursor.repository';
import { ExternalRawEventRepository } from '../repositories/external-raw-event.repository';
import { SyncJobNotFoundError } from '../errors/sync-errors';
import {
  RawEventDto,
  RawEventListQueryDto,
  StoreSyncOverviewDto,
  SyncJobDto,
  SyncJobListQueryDto,
} from '../dto/sync.dto';
import { ExternalRawEventEntity } from '../entities/external-raw-event.entity';
import { SyncJobEntity } from '../entities/sync-job.entity';

/** Read models for the Sync Center + store sync tab (Sprint 5 task §34/§35). */
@Injectable()
export class SyncJobService {
  constructor(
    private readonly jobRepo: SyncJobRepository,
    private readonly cursorRepo: SyncCursorRepository,
    private readonly rawEventRepo: ExternalRawEventRepository,
    private readonly credentialService: PlatformCredentialService,
    private readonly storeService: StoreService,
    private readonly platformService: PlatformService,
  ) {}

  async list(query: SyncJobListQueryDto): Promise<{
    rows: Array<SyncJobEntity & { storeCode: string; storeName: string; platformCode: string }>;
    total: number;
  }> {
    return this.jobRepo.list(
      {
        storeId: query.storeId,
        syncType: query.syncType,
        status: query.status,
      },
      query.pageSize,
      (query.page - 1) * query.pageSize,
    );
  }

  async getDto(id: string): Promise<SyncJobDto> {
    const job = await this.jobRepo.findById(id);
    if (job === null) {
      throw new SyncJobNotFoundError(id);
    }
    const store = await this.storeService.getEntityById(job.storeId);
    const platform =
      store === null ? null : await this.platformService.getEntityById(store.platformId);
    return this.toDto(job, {
      storeCode: store?.storeCode ?? '',
      storeName: store?.name ?? '',
      platformCode: platform?.code ?? '',
    });
  }

  async storeOverview(storeId: string): Promise<StoreSyncOverviewDto> {
    const store = await this.storeService.getEntityById(storeId);
    if (store === null) {
      throw new StoreNotFoundError(storeId);
    }
    const platform = await this.platformService.getEntityById(store.platformId);
    const credential = await this.credentialService.getValidationMeta(storeId, 'MAIN_API');
    const [lastOrder, lastListing, orderCursor, active] = await Promise.all([
      this.jobRepo.lastFinished(storeId, 'ORDER_SYNC'),
      this.jobRepo.lastFinished(storeId, 'LISTING_SYNC'),
      this.cursorRepo.find(storeId, 'ORDER_SYNC'),
      this.jobRepo.findActiveByStoreAndType(storeId, 'ORDER_SYNC'),
    ]);
    return {
      storeId,
      storeCode: store.storeCode,
      platformCode: platform?.code ?? '',
      credential,
      lastOrderSync: lastOrder,
      lastListingSync: lastListing,
      consecutiveFailures: orderCursor?.consecutiveFailures ?? 0,
      activeJobId: active?.id ?? null,
    };
  }

  async listRawEvents(
    query: RawEventListQueryDto,
  ): Promise<{ rows: ExternalRawEventEntity[]; total: number }> {
    return this.rawEventRepo.list(
      { storeId: query.storeId, status: query.status },
      query.pageSize,
      (query.page - 1) * query.pageSize,
    );
  }

  toDto(
    job: SyncJobEntity,
    refs: { storeCode: string; storeName: string; platformCode: string },
    _operator?: { userId: string | null; username: string },
  ): SyncJobDto {
    return {
      id: job.id,
      storeId: job.storeId,
      storeCode: refs.storeCode,
      storeName: refs.storeName,
      platformCode: refs.platformCode,
      syncType: job.syncType,
      status: job.status,
      triggerType: job.triggerType,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      successCount: job.successCount,
      failedCount: job.failedCount,
      skippedCount: job.skippedCount,
      retryCount: job.retryCount,
      cursorBefore: job.cursorBefore,
      cursorAfter: job.cursorAfter,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      durationMs:
        job.startedAt !== null && job.finishedAt !== null
          ? new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()
          : null,
    };
  }

  toRawEventDto(event: ExternalRawEventEntity): RawEventDto {
    return {
      id: event.id,
      platform: event.platform,
      storeId: event.storeId,
      eventType: event.eventType,
      externalEventId: event.externalEventId,
      payload: event.payload,
      payloadHash: event.payloadHash,
      status: event.status,
      receivedAt: event.receivedAt,
      processedAt: event.processedAt,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
    };
  }
}
