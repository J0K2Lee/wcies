import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SyncJobEntity } from '../entities/sync-job.entity';
import { SyncJobStatus, SyncTriggerType, SyncType } from '../sync.constants';

export interface SyncJobListFilters {
  storeId?: string;
  syncType?: string;
  status?: string;
}

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class SyncJobRepository {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SyncJobEntity)
    private readonly repository: Repository<SyncJobEntity>,
  ) {}

  /**
   * Single-flight insert (task §15/§45): the partial unique index
   * uq_sync_jobs_active rejects a second PENDING/RUNNING job for the same
   * (store, syncType). Returns null when the guard tripped.
   */
  async insertPending(input: {
    storeId: string;
    syncType: SyncType;
    triggerType: SyncTriggerType;
    cursorBefore: Record<string, unknown> | null;
  }): Promise<SyncJobEntity | null> {
    const result = await this.dataSource.query<SyncJobRow[]>(
      `INSERT INTO sync_jobs (store_id, sync_type, status, trigger_type, cursor_before)
       VALUES ($1, $2, 'PENDING', $3, $4::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        input.storeId,
        input.syncType,
        input.triggerType,
        JSON.stringify(input.cursorBefore ?? null),
      ],
    );
    const inserted = result[0];
    return inserted === undefined ? null : hydrateRow(inserted);
  }

  /** Atomic claim PENDING -> RUNNING; false = duplicate delivery / stale. */
  async claimRunning(id: string): Promise<boolean> {
    const result = await this.dataSource.query<Array<{ id: string }>>(
      `UPDATE sync_jobs SET status = 'RUNNING', started_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'PENDING'
       RETURNING id`,
      [id],
    );
    return result.length === 1;
  }

  async finalize(
    id: string,
    patch: {
      status: SyncJobStatus;
      successCount?: number;
      failedCount?: number;
      skippedCount?: number;
      cursorAfter?: Record<string, unknown> | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE sync_jobs SET
         status = $2,
         success_count = COALESCE($3, success_count),
         failed_count = COALESCE($4, failed_count),
         skipped_count = COALESCE($5, skipped_count),
         cursor_after = COALESCE($6::jsonb, cursor_after),
         error_code = $7,
         error_message = $8,
         finished_at = now(),
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        patch.status,
        patch.successCount ?? null,
        patch.failedCount ?? null,
        patch.skippedCount ?? null,
        patch.cursorAfter === undefined ? null : JSON.stringify(patch.cursorAfter),
        patch.errorCode ?? null,
        patch.errorMessage ?? null,
      ],
    );
  }

  async findById(id: string): Promise<SyncJobEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async findActiveByStoreAndType(storeId: string, syncType: string): Promise<SyncJobEntity | null> {
    return this.repository
      .findOneBy({
        storeId,
        syncType,
        status: 'PENDING' as string,
      })
      .then(
        (pending) => pending ?? this.repository.findOneBy({ storeId, syncType, status: 'RUNNING' }),
      );
  }

  async list(
    filters: SyncJobListFilters,
    limit: number,
    offset: number,
  ): Promise<{
    rows: Array<SyncJobEntity & { storeCode: string; storeName: string; platformCode: string }>;
    total: number;
  }> {
    const qb = this.repository
      .createQueryBuilder('job')
      .innerJoin('stores', 'store', 'store.id = job.store_id')
      .innerJoin('platforms', 'platform', 'platform.id = store.platform_id')
      .addSelect('store.store_code', 'store_code')
      .addSelect('store.name', 'store_name')
      .addSelect('platform.code', 'platform_code');
    if (filters.storeId !== undefined) {
      qb.andWhere('job.store_id = :storeId', { storeId: filters.storeId });
    }
    if (filters.syncType !== undefined) {
      qb.andWhere('job.sync_type = :syncType', { syncType: filters.syncType });
    }
    if (filters.status !== undefined) {
      qb.andWhere('job.status = :status', { status: filters.status });
    }
    qb.orderBy('job.created_at', 'DESC').skip(offset).take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<{
      store_code?: string | null;
      store_name?: string | null;
      platform_code?: string | null;
    }>;
    return {
      rows: entities.map((entity, index) => ({
        ...entity,
        storeCode: rawList[index]?.store_code ?? '',
        storeName: rawList[index]?.store_name ?? '',
        platformCode: rawList[index]?.platform_code ?? '',
      })),
      total,
    };
  }

  /** Consecutive FAILED terminal jobs for a store+type (store sync tab). */
  async consecutiveFailures(storeId: string, syncType: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ status: string }>>(
      `SELECT status FROM sync_jobs
       WHERE store_id = $1 AND sync_type = $2
         AND status IN ('SUCCESS', 'PARTIAL', 'FAILED')
       ORDER BY created_at DESC LIMIT 20`,
      [storeId, syncType],
    );
    let count = 0;
    for (const row of rows) {
      if (row.status === 'FAILED') {
        count += 1;
      } else {
        break;
      }
    }
    return count;
  }

  async lastFinished(
    storeId: string,
    syncType: string,
  ): Promise<{ status: string; finishedAt: Date | null } | null> {
    const rows = await this.dataSource.query<
      Array<{ status: string; finished_at: Date | string | null }>
    >(
      `SELECT status, finished_at FROM sync_jobs
       WHERE store_id = $1 AND sync_type = $2 AND finished_at IS NOT NULL
       ORDER BY finished_at DESC LIMIT 1`,
      [storeId, syncType],
    );
    const first = rows[0];
    if (first === undefined) {
      return null;
    }
    return {
      status: first.status,
      finishedAt: first.finished_at === null ? null : new Date(first.finished_at),
    };
  }

  /** Cancels jobs stuck in RUNNING (process crash recovery, scheduler tick). */
  async failStaleRunning(olderThanMinutes: number): Promise<number> {
    const result = await this.dataSource.query<Array<{ id: string }>>(
      `UPDATE sync_jobs SET
         status = 'FAILED',
         error_code = 'SYNC_JOB_STALE',
         error_message = 'Job interrupted (worker/process restart); safe to retry - cursor not advanced',
         finished_at = now(),
         updated_at = now()
       WHERE status = 'RUNNING' AND started_at < now() - ($1 || ' minutes')::interval
       RETURNING id`,
      [String(olderThanMinutes)],
    );
    return result.length;
  }
}

/** Raw sync_jobs row shape returned by INSERT ... RETURNING *. */
interface SyncJobRow {
  id: string;
  store_id: string;
  sync_type: string;
  status: string;
  trigger_type: string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  cursor_before: Record<string, unknown> | null;
  cursor_after: Record<string, unknown> | null;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  retry_count: number;
  error_code: string | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function hydrateRow(row: SyncJobRow): SyncJobEntity {
  const job = new SyncJobEntity();
  job.id = row.id;
  job.storeId = row.store_id;
  job.syncType = row.sync_type;
  job.status = row.status;
  job.triggerType = row.trigger_type;
  job.startedAt = toDate(row.started_at);
  job.finishedAt = toDate(row.finished_at);
  job.cursorBefore = row.cursor_before ?? null;
  job.cursorAfter = row.cursor_after ?? null;
  job.successCount = row.success_count;
  job.failedCount = row.failed_count;
  job.skippedCount = row.skipped_count;
  job.retryCount = row.retry_count;
  job.errorCode = row.error_code;
  job.errorMessage = row.error_message;
  job.createdAt = new Date(row.created_at);
  job.updatedAt = new Date(row.updated_at);
  return job;
}
