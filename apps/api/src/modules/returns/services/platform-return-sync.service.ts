import { Injectable } from '@nestjs/common';
import { PlatformReturnRaw, StoreContext } from '@wcies/platform-contracts';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { OrderService } from '../../order/services/order.service';
import { SyncContextService } from '../../sync/services/sync-context.service';
import { PlatformAdapterRegistry } from '../../integration/platform-adapter.registry';
import { PlatformReturnRepository } from '../repositories/platform-return.repository';
import { PlatformReturnView } from '../dto/return.dto';

/** Page size for the manual return sync (per adapter call). */
const RETURN_SYNC_PAGE = 200;

/**
 * Platform return-record sync (dual-axis T5, returns.md §2): pull-only facts
 * from the platform (OZON /v2/returns/rfbs/list). Never writes stock. Every
 * record tries a store-scoped order linkage via posting_number; a miss
 * raises RETURN_ORDER_NOT_FOUND - the operator links or acknowledges it
 * later. Upserts are compare-and-write (unchanged records write nothing).
 */
@Injectable()
export class PlatformReturnSyncService {
  constructor(
    private readonly contextService: SyncContextService,
    private readonly registry: PlatformAdapterRegistry,
    private readonly orderService: OrderService,
    private readonly exceptionService: ExceptionService,
    private readonly platformReturnRepo: PlatformReturnRepository,
    private readonly operationLog: OperationLogService,
  ) {}

  /** Manual full pull for one store (all pages, bounded by adapter cursor). */
  async syncStoreReturns(
    storeId: string,
    operator: OperatorContext,
  ): Promise<{
    created: number;
    updated: number;
    unlinkable: number;
  }> {
    const { store, adapter } = await this.contextService.resolveSyncableStore(storeId);
    if (adapter.fetchReturns === undefined) {
      throw new Error(`平台 ${adapter.platformCode} 不支持退货记录拉取`);
    }
    const context: StoreContext = await this.contextService.buildStoreContext(store);

    let created = 0;
    let updated = 0;
    let unlinkable = 0;
    let cursor: unknown = undefined;
    for (;;) {
      const page = await adapter.fetchReturns(context, cursor);
      for (const raw of page.items) {
        const outcome = await this.upsertOne(store.id, raw);
        if (outcome === 'CREATED') {
          created += 1;
        } else if (outcome === 'UPDATED') {
          updated += 1;
        }
        if (await this.isUnlinked(store.id, raw)) {
          unlinkable += 1;
        }
      }
      if (!page.hasMore || page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
      if (created + updated > RETURN_SYNC_PAGE * 50) {
        break; // Safety valve: a manual run never pages unbounded.
      }
    }
    await this.operationLog.record({
      entityType: 'PLATFORM_RETURN',
      entityId: store.id,
      entityCode: store.storeCode,
      action: 'SYNC_RETURNS',
      changes: { created: { from: null, to: created }, updated: { from: null, to: updated } },
      operator,
    });
    return { created, updated, unlinkable };
  }

  async list(
    filters: { storeId?: string; orderId?: string; linked?: boolean },
    page: { page: number; pageSize: number },
  ): Promise<{ items: PlatformReturnView[]; meta: PageMeta }> {
    const { rows, total } = await this.platformReturnRepo.list({
      ...filters,
      limit: page.pageSize,
      offset: (page.page - 1) * page.pageSize,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        storeId: row.storeId,
        platformReturnId: row.platformReturnId,
        platformOrderId: row.platformOrderId,
        orderId: row.orderId,
        state: row.state,
        refundState: row.refundState,
        platformSkuId: row.platformSkuId,
        offerId: row.offerId,
        quantity: row.quantity,
        platformCreatedAt: row.platformCreatedAt,
        createdAt: row.createdAt,
      })),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  // --------------------------------------------------------------------------

  private async upsertOne(
    storeId: string,
    raw: PlatformReturnRaw,
  ): Promise<'CREATED' | 'UPDATED' | 'UNCHANGED'> {
    const existing = await this.platformReturnRepo.findByStoreAndReturnId(
      storeId,
      raw.platformReturnId,
    );
    if (existing === null) {
      const orderId = await this.linkOrder(storeId, raw.platformOrderId);
      const created = await this.platformReturnRepo.insert({
        ...PlatformReturnRepository.toRow(raw, storeId),
        orderId,
      });
      if (orderId === null && raw.platformOrderId !== null) {
        // system_exceptions.reference_id is a uuid column, so the exception
        // must hang off the JUST-CREATED record id (insert first, raise
        // second); (type, reference) OPEN dedup keeps re-syncs single-row.
        await this.raiseUnlinkable(storeId, raw, created.id);
      }
      return 'CREATED';
    }
    const stateChanged = raw.state !== null && raw.state !== existing.state;
    const refundChanged = raw.refundState !== null && raw.refundState !== existing.refundState;
    if (!stateChanged && !refundChanged) {
      return 'UNCHANGED';
    }
    await this.platformReturnRepo.updateFacts(existing.id, {
      ...(stateChanged ? { state: raw.state } : {}),
      ...(refundChanged ? { refundState: raw.refundState } : {}),
    });
    return 'UPDATED';
  }

  /** Store-scoped order linkage by posting number (AGENTS.md §26/§35). */
  private async linkOrder(storeId: string, platformOrderId: string | null): Promise<string | null> {
    if (platformOrderId === null) {
      return null;
    }
    return this.orderService.findIdByStoreAndPlatformOrder(storeId, platformOrderId);
  }

  private async isUnlinked(storeId: string, raw: PlatformReturnRaw): Promise<boolean> {
    if (raw.platformOrderId === null) {
      return false; // No order reference on the platform record: not an error.
    }
    const orderId = await this.linkOrder(storeId, raw.platformOrderId);
    return orderId === null;
  }

  private async raiseUnlinkable(
    storeId: string,
    raw: PlatformReturnRaw,
    platformReturnRowId: string,
  ): Promise<void> {
    await this.exceptionService.create({
      exceptionType: 'RETURN_ORDER_NOT_FOUND',
      severity: 'HIGH',
      referenceType: 'PLATFORM_RETURN',
      referenceId: platformReturnRowId,
      storeId,
      message: `平台退货记录 ${raw.platformReturnId} 引用订单 ${raw.platformOrderId} 在系统内不存在（请核对订单同步是否遗漏）`,
      details: {
        platformReturnId: raw.platformReturnId,
        platformOrderId: raw.platformOrderId,
      },
    });
  }
}
