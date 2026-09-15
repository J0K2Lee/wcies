import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExceptionService } from '../../exception/services/exception.service';
import { ORDER_TRACKING_STALL_DAYS } from '../enums/order.constants';

const STALL_MS = ORDER_TRACKING_STALL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Platform-logistics stall policy (dual-axis T4, orders.md §16A).
 *
 * User rule (2026-09-15): an order is stalled when its platform stage has
 * been IN_TRANSIT for more than 3 days without movement. Key properties:
 *
 * - the clock anchors on the PLATFORM's own timestamp
 *   (orders.platform_stage_changed_at - OZON delivering_date / webhook
 *   changed_state_date), never our receive time (docs §2.4);
 * - evaluation runs on EVERY fallback-rotation encounter - stalled orders
 *   are precisely the ones where nothing changed, so evaluating only on
 *   change would never catch them (A11, same pattern as the deadline
 *   re-evaluation in orders.md §16);
 * - reaching DELIVERED / CANCELLED auto-resolves, including through the
 *   pure re-read path (acceptance §5) - the rotation guarantees every
 *   non-terminal order is observed at least once per fallback window even
 *   with webhooks paused (ozon.md §6.5 auto-pause is a real risk).
 *
 * Dedup and resolution ride on the exception center's (type, reference)
 * OPEN semantics; a no-change evaluation writes nothing.
 */
@Injectable()
export class OrderTrackingStallService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly exceptionService: ExceptionService,
  ) {}

  async evaluate(order: {
    id: string;
    orderNo: string;
    storeId: string;
    platformStage: string | null;
    platformStageChangedAt: Date | string | null;
  }): Promise<void> {
    if (order.platformStage !== 'IN_TRANSIT') {
      // Not in transit (never was, or already DELIVERED/CANCELLED): any OPEN
      // stall alert from an earlier encounter is now wrong - close it.
      await this.dataSource.transaction(async (runner) => {
        await this.exceptionService.resolveByReferenceInTx(runner, {
          exceptionType: 'ORDER_TRACKING_STALLED',
          referenceType: 'ORDER',
          referenceId: order.id,
        });
      });
      return;
    }
    const anchorRaw = order.platformStageChangedAt ?? null;
    const anchor = anchorRaw === null ? null : new Date(anchorRaw);
    if (anchor === null || Number.isNaN(anchor.getTime())) {
      // IN_TRANSIT without any usable anchor: cannot judge - do not guess.
      return;
    }
    if (Date.now() - anchor.getTime() <= STALL_MS) {
      return;
    }
    const anchorIso = anchor.toISOString();
    await this.exceptionService.create({
      exceptionType: 'ORDER_TRACKING_STALLED',
      severity: 'MEDIUM',
      referenceType: 'ORDER',
      referenceId: order.id,
      storeId: order.storeId,
      message: `订单 ${order.orderNo} 物流停滞：平台在途（IN_TRANSIT）自 ${anchorIso} 起超过 ${ORDER_TRACKING_STALL_DAYS} 天未更新`,
      details: {
        orderNo: order.orderNo,
        platformStage: order.platformStage,
        platformStageChangedAt: anchorIso,
        stallDays: ORDER_TRACKING_STALL_DAYS,
      },
    });
  }
}
