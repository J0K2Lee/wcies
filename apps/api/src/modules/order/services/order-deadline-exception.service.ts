import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExceptionService } from '../../exception/services/exception.service';

/** Deadline within this window (or past) keeps ORDER_SHIPMENT_DEADLINE_NEAR
 *  OPEN; beyond it an OPEN exception is resolved (orders.md §16). */
const DEADLINE_NEAR_MS = 24 * 60 * 60 * 1000;

/**
 * Shipment-deadline exception policy (Sprint 7 orders.md §16; Sprint 9 T1
 * extends evaluation from "once at ingest" to "every sync encounter").
 *
 * The evaluation is time-dependent: a deadline that was far away at ingest
 * silently becomes urgent as the clock advances, so it must be re-checked
 * whenever ORDER_SYNC re-observes the order - even when no fact field
 * changed. Dedup and resolution ride on the exception center's
 * (type, reference) OPEN semantics, so a no-change evaluation writes
 * nothing.
 */
@Injectable()
export class OrderDeadlineExceptionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly exceptionService: ExceptionService,
  ) {}

  /**
   * Brings the OPEN state of ORDER_SHIPMENT_DEADLINE_NEAR in line with the
   * order's current deadline: raises (deduped) when past due or < 24h,
   * resolves when >= 24h remain. Missing/invalid deadlines are left alone.
   */
  async evaluate(order: {
    id: string;
    orderNo: string;
    storeId: string;
    shipmentDeadline: Date | string | null;
  }): Promise<void> {
    const raw = order.shipmentDeadline ?? null;
    const deadline = raw === null ? null : new Date(raw);
    if (deadline === null || Number.isNaN(deadline.getTime())) {
      return;
    }
    const remainingMs = deadline.getTime() - Date.now();
    if (remainingMs >= DEADLINE_NEAR_MS) {
      // Platform pushed the deadline out (or it was never urgent): an OPEN
      // alert from an earlier evaluation is now wrong - close it.
      await this.dataSource.transaction(async (runner) => {
        await this.exceptionService.resolveByReferenceInTx(runner, {
          exceptionType: 'ORDER_SHIPMENT_DEADLINE_NEAR',
          referenceType: 'ORDER',
          referenceId: order.id,
        });
      });
      return;
    }
    const overdue = remainingMs < 0;
    const deadlineIso = deadline.toISOString();
    await this.exceptionService.create({
      exceptionType: 'ORDER_SHIPMENT_DEADLINE_NEAR',
      severity: overdue ? 'HIGH' : 'MEDIUM',
      referenceType: 'ORDER',
      referenceId: order.id,
      storeId: order.storeId,
      message: overdue
        ? `订单 ${order.orderNo} 平台发货时限已超时（${deadlineIso}），平台将按更高费率计费`
        : `订单 ${order.orderNo} 平台发货时限临近（${deadlineIso}，剩余不足 24 小时）`,
      details: { orderNo: order.orderNo, shipmentDeadline: deadlineIso },
    });
  }
}
