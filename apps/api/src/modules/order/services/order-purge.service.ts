import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OperationLogService, OperatorContext } from '../../operation-log/operation-log.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { OrderRepository } from '../repositories/order.repository';
import {
  OrderNotFoundError,
  OrderPurgeBlockedError,
  OrderPurgeConfirmMismatchError,
  OrderPurgeInvalidStateError,
} from '../errors/order.errors';

/** 删除前的影响面（只读）：被哪些业务事实引用。 */
export interface OrderPurgePreview {
  orderId: string;
  orderNo: string;
  platformOrderId: string;
  erpStatus: string;
  items: Array<{ id: string; lineNo: number; fulfillmentStatus: string }>;
  /** 会随订单一并删除的附属行数。 */
  willDelete: {
    items: number;
    statusHistory: number;
    platformStatusHistory: number;
    exceptions: number;
  };
  /** 阻止删除的业务事实（非空即拒绝）。 */
  blockers: string[];
}

/**
 * 「错误摄入的订单」彻底移除（2026-10-24 用户指示）。
 *
 * 语义：这张单**本不该存在**（平台事实没有对应关系 / 与另一张单是同一事实），
 * 所以不是「取消」而是删除——取消会把它留在已取消列表、统计与后续查重里。
 *
 * 硬约束（AGENTS §14/§101.10：任何库存变化都必须有可追溯的流水）：
 * 只要该订单产生过任何**真实业务事实**（库存流水/占用/拣货/发货/结算/财务/
 * 拦截/面单/被采购单引用），就**拒绝**删除——删掉会让流水指向不存在的订单，
 * 追溯链断裂。这类单只能走取消 + 合并/退回等正式流程。
 *
 * 删除范围：订单头、明细、两张状态历史、行级/单级异常（它们只属于这张单）。
 */
@Injectable()
export class OrderPurgeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly orderRepo: OrderRepository,
    private readonly exceptionService: ExceptionService,
    private readonly operationLog: OperationLogService,
  ) {}

  async preview(orderId: string): Promise<OrderPurgePreview> {
    const order = await this.orderRepo.findById(orderId);
    if (order === null) {
      throw new OrderNotFoundError(orderId);
    }
    const items = await this.dataSource.query<
      Array<{ id: string; line_no: number; fulfillment_status: string }>
    >(
      `SELECT id, line_no, fulfillment_status FROM order_items WHERE order_id = $1 ORDER BY line_no`,
      [orderId],
    );
    const itemIds = items.map((row) => row.id);
    const counts = await this.countSideEffects(orderId, itemIds);
    const history = await this.dataSource.query<
      Array<{ status_history: string; platform_history: string; exceptions: string }>
    >(
      `SELECT
         (SELECT COUNT(*) FROM order_status_history WHERE order_id = $1)::text AS status_history,
         (SELECT COUNT(*) FROM platform_status_history WHERE order_id = $1)::text AS platform_history,
         (SELECT COUNT(*) FROM system_exceptions
           WHERE (reference_type = 'ORDER' AND reference_id = $1::uuid)
              OR (reference_type = 'ORDER_ITEM' AND reference_id = ANY($2::uuid[])))::text AS exceptions`,
      [orderId, itemIds],
    );
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      platformOrderId: order.platformOrderId,
      erpStatus: order.erpStatus,
      items: items.map((row) => ({
        id: row.id,
        lineNo: row.line_no,
        fulfillmentStatus: row.fulfillment_status,
      })),
      willDelete: {
        items: items.length,
        statusHistory: Number(history[0]?.status_history ?? 0),
        platformStatusHistory: Number(history[0]?.platform_history ?? 0),
        exceptions: Number(history[0]?.exceptions ?? 0),
      },
      blockers: blockersOf(counts),
    };
  }

  async purge(
    orderId: string,
    operator: OperatorContext,
    input: { reason: string; confirmOrderNo: string },
  ): Promise<{ orderId: string; orderNo: string; deleted: OrderPurgePreview['willDelete'] }> {
    const preview = await this.preview(orderId);
    if (preview.blockers.length > 0) {
      throw new OrderPurgeBlockedError(preview.orderNo, preview.blockers);
    }
    if (preview.erpStatus === 'SHIPPED' || preview.erpStatus === 'PARTIALLY_SHIPPED') {
      throw new OrderPurgeInvalidStateError(preview.orderNo, preview.erpStatus);
    }
    if (input.confirmOrderNo.trim() !== preview.orderNo) {
      throw new OrderPurgeConfirmMismatchError(preview.orderNo);
    }
    const reason = input.reason.trim().slice(0, 450);

    const deleted = await this.dataSource.transaction(async (manager) => {
      // 先删附属行，再删明细，最后删订单头（FK 都是 NO ACTION）。
      await this.exceptionService.deleteByReferenceInTx(manager, {
        orderId,
        orderItemIds: preview.items.map((item) => item.id),
      });
      await manager.query(`DELETE FROM platform_status_history WHERE order_id = $1`, [orderId]);
      await manager.query(`DELETE FROM order_status_history WHERE order_id = $1`, [orderId]);
      await manager.query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]);
      await manager.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
      return preview.willDelete;
    });

    await this.operationLog.record({
      entityType: 'ORDER',
      entityId: orderId,
      entityCode: preview.orderNo,
      action: 'PURGE_ORDER',
      changes: {
        platformOrderId: { from: preview.platformOrderId, to: null },
        erpStatus: { from: preview.erpStatus, to: null },
        reason: { from: null, to: reason },
        deletedItems: { from: null, to: deleted.items },
      },
      operator,
    });
    return { orderId, orderNo: preview.orderNo, deleted };
  }

  private async countSideEffects(
    orderId: string,
    itemIds: readonly string[],
  ): Promise<Record<string, number>> {
    // 一次性探测所有引用方：这些表属于别的模块，但这里只做**只读安全探测**，
    // 不解读它们的业务语义（删除前的最后一道闸）。
    const rows = await this.dataSource.query<
      Array<{
        ledger: string;
        reservations: string;
        picking: string;
        shipments: string;
        settlements: string;
        settlement_items: string;
        finance: string;
        interceptions: string;
        labels: string;
        purchase_items: string;
      }>
    >(
      `SELECT
         (SELECT COUNT(*) FROM inventory_transactions
           WHERE (reference_type = 'ORDER' AND reference_id = $1::uuid)
              OR (reference_type = 'ORDER_ITEM' AND reference_id = ANY($2::uuid[])))::text AS ledger,
         (SELECT COUNT(*) FROM inventory_reservations
           WHERE (reference_type = 'ORDER' AND reference_id = $1::uuid)
              OR (reference_type = 'ORDER_ITEM' AND reference_id = ANY($2::uuid[])))::text AS reservations,
         (SELECT COUNT(*) FROM picking_task_items WHERE order_id = $1::uuid)::text AS picking,
         (SELECT COUNT(*) FROM shipments WHERE order_id = $1::uuid)::text AS shipments,
         (SELECT COUNT(*) FROM order_settlements WHERE order_id = $1::uuid)::text AS settlements,
         (SELECT COUNT(*) FROM order_settlement_items WHERE order_item_id = ANY($2::uuid[]))::text AS settlement_items,
         (SELECT COUNT(*) FROM finance_transactions WHERE order_id = $1::uuid)::text AS finance,
         (SELECT COUNT(*) FROM order_interceptions WHERE order_id = $1::uuid)::text AS interceptions,
         (SELECT COUNT(*) FROM shipping_labels WHERE order_id = $1::uuid)::text AS labels,
         (SELECT COUNT(*) FROM purchase_order_items WHERE order_item_id = ANY($2::uuid[]))::text AS purchase_items`,
      [orderId, [...itemIds]],
    );
    const row = rows[0];
    if (row === undefined) {
      return {};
    }
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  }
}

const BLOCKER_LABELS: Record<string, string> = {
  ledger: '库存流水',
  reservations: '库存占用',
  picking: '拣货任务',
  shipments: '发货单',
  settlements: '订单结算',
  settlement_items: '结算明细',
  finance: '财务流水',
  interceptions: '拦截任务',
  labels: '平台面单',
  purchase_items: '采购明细引用',
};

function blockersOf(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${BLOCKER_LABELS[key] ?? key} ${count} 条`);
}
