import { DomainError } from '../../../common/errors/domain.error';

/** Another sync for the same store + sync type is PENDING/RUNNING (§15/§53). */
export class SyncAlreadyRunningError extends DomainError {
  readonly code = 'SYNC_ALREADY_RUNNING';
  readonly httpStatus = 409;

  constructor(storeId: string, syncType: string, activeJobId: string | null) {
    super(`Store ${storeId} already has an active ${syncType} job`, {
      storeId,
      syncType,
      activeJobId,
    });
  }
}

/** Sync job not found. */
export class SyncJobNotFoundError extends DomainError {
  readonly code = 'SYNC_JOB_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Sync job not found: ${id}`, { id });
  }
}

/** The store cannot be synced (missing/inactive/unsupported platform). */
export class SyncStoreNotSyncableError extends DomainError {
  readonly code = 'SYNC_STORE_NOT_SYNCABLE';
  readonly httpStatus = 409;

  constructor(storeId: string, reason: string) {
    super(`Store ${storeId} cannot be synced: ${reason}`, { storeId, reason });
  }
}
