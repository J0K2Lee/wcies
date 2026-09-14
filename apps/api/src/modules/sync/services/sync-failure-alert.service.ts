import { Injectable } from '@nestjs/common';
import { ExceptionService } from '../../exception/services/exception.service';
import { SyncCursorRepository } from '../repositories/sync-cursor.repository';
import { SYNC_FAILED_CONSECUTIVE_FAILURES } from '../sync.constants';

/**
 * Sprint 9 T2 (decision 3): scheduled-sync health -> exception center.
 *
 * Call onFinalized(storeId) after every ORDER_SYNC / LISTING_SYNC finalize.
 * When any sync type of the store has failed >= SYNC_FAILED_CONSECUTIVE_FAILURES
 * times in a row, exactly ONE OPEN `SYNC_FAILED` exception (reference
 * STORE/storeId) reports the whole failing picture; once every sync type is
 * healthy again it auto-resolves. The single-open-row guarantee rides on the
 * exception center's (type, reference) OPEN dedup.
 */
@Injectable()
export class SyncFailureAlertService {
  constructor(
    private readonly cursorRepo: SyncCursorRepository,
    private readonly exceptionService: ExceptionService,
  ) {}

  async onFinalized(storeId: string): Promise<void> {
    const cursors = await this.cursorRepo.listByStore(storeId);
    const failing = cursors
      .filter((cursor) => cursor.consecutiveFailures >= SYNC_FAILED_CONSECUTIVE_FAILURES)
      .map((cursor) => ({
        syncType: cursor.syncType,
        consecutiveFailures: cursor.consecutiveFailures,
      }));
    if (failing.length === 0) {
      await this.exceptionService.resolveByReference({
        exceptionType: 'SYNC_FAILED',
        referenceType: 'STORE',
        referenceId: storeId,
      });
      return;
    }
    const picture = failing
      .map((entry) => `${entry.syncType} 连续失败 ${entry.consecutiveFailures} 次`)
      .join('；');
    await this.exceptionService.upsertOpen({
      exceptionType: 'SYNC_FAILED',
      severity: 'HIGH',
      referenceType: 'STORE',
      referenceId: storeId,
      storeId,
      message: `店铺同步持续失败：${picture}（连续 ${SYNC_FAILED_CONSECUTIVE_FAILURES} 次以上未成功）`,
      details: {
        failing,
        threshold: SYNC_FAILED_CONSECUTIVE_FAILURES,
      },
    });
  }
}
