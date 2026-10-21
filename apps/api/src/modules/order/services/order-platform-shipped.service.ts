import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderStatusService, isBlockingMappingFailure } from './order-status.service';
import { ErpOrderStatus } from '../enums/order.constants';

export interface PlatformShippedOutcome {
  /** True when the order is (or became) SHIPPED through this convergence. */
  shipped: boolean;
  /** The order's ERP status after the convergence. */
  erpStatus: ErpOrderStatus;
}

/**
 * 平台已事实发货的收敛（用户指示 2026-10-14）。
 *
 * OZON 同步到的订单处于 `delivering` / `delivered`（归一化平台阶段
 * `IN_TRANSIT` / `DELIVERED`）时，货物在平台侧已经发走——WCIES 内部
 * 的「预发货」状态与现实矛盾：
 *
 * - 缺货行（`MAPPED` 且 `BACKORDERED` / `PENDING`）转
 *   `EXTERNAL_FULFILLED`：平台侧已履约完成，不再占用内部库存、不进入
 *   拣货 / 待采购 / 自动重分配（这些口径都只认 BACKORDERED/PENDING 行）；
 * - 关闭行上 OPEN 的 `ORDER_OUT_OF_STOCK` 与订单级
 *   `ORDER_SHIPMENT_DEADLINE_NEAR`——已发货的订单继续挂缺货/时限
 *   待办与现实不一致（AGENTS.md §53 要求异常可见，同样要求不虚构）；
 * - 无未映射异常（无 `FAILED` 行）时订单经 `OrderStatusService`
 *   `.transition` 转 `SHIPPED`（§38：erp_status 只此一处可写）；仍有
 *   `FAILED` 行时重算 rollup，订单继续由未映射异常阻塞——用户指示：
 *   **除了未映射异常，已事实发货的订单不应被缺货阻塞**。
 * - 内部履约仍在进行（存在 `RESERVED` / `PICKED` 行）时**不**自动转
 *   SHIPPED：那批货可能还在我们的仓内，平台状态与现实谁对谁错需要人
 *   判——按双轴差异协议留待运营处理（§8A 标记外部履约 / 取消），缺货
 *   部分已在上一步收敛，订单不再被缺货阻塞。
 *
 * 不产生任何库存流水（AGENTS.md §14）：这些行从未持有内部库存
 * （ Reservation 失败才进入 BACKORDERED）。全部写操作幂等：同步链路
 * 每次再遇事实发货订单都会走到这里，重复调用只做无操作写。
 */
@Injectable()
export class OrderPlatformShippedService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly itemRepo: OrderItemRepository,
    private readonly exceptionService: ExceptionService,
    private readonly statusService: OrderStatusService,
  ) {}

  async apply(
    order: OrderEntity,
    operator: OperatorContext,
    reason: string,
  ): Promise<PlatformShippedOutcome> {
    const items = await this.itemRepo.findByOrderId(order.id);
    // 等待中的行 = 已映射但未内部履约（缺货 / 从未分配成功）。FAILED 行
    // 不在此列——未映射异常继续阻塞（用户指示 2026-10-14）。
    const waiting = items.filter(
      (item: OrderItemEntity) =>
        item.mappingStatus !== 'FAILED' &&
        (item.fulfillmentStatus === 'BACKORDERED' || item.fulfillmentStatus === 'PENDING'),
    );
    await this.dataSource.transaction(async (runner) => {
      for (const item of items) {
        await this.exceptionService.resolveByReferenceInTx(runner, {
          exceptionType: 'ORDER_OUT_OF_STOCK',
          referenceType: 'ORDER_ITEM',
          referenceId: item.id,
        });
      }
      for (const item of waiting) {
        await this.itemRepo.updateFulfillment(runner, item.id, {
          fulfillmentStatus: 'EXTERNAL_FULFILLED',
        });
      }
    });
    // 发货时限只对「还没发走」的订单构成内部作业压力；货物已上车，
    // 既不再评估（调用方跳过），也不再留 OPEN 警报。
    await this.dataSource.transaction(async (runner) => {
      await this.exceptionService.resolveByReferenceInTx(runner, {
        exceptionType: 'ORDER_SHIPMENT_DEADLINE_NEAR',
        referenceType: 'ORDER',
        referenceId: order.id,
      });
    });

    if (items.some(isBlockingMappingFailure)) {
      // 未映射异常是唯一被允许的阻塞：rollup 会把订单落到 EXCEPTION。
      // 已 RELEASED / EXTERNAL_FULFILLED 的 FAILED 行不再阻塞（2026-10-20）：
      // 平台已事实发货，未映射不再可执行，不能把订单翻回 EXCEPTION。
      const erpStatus = await this.statusService.recomputeOrderStatus(
        order.id,
        operator,
        `${reason}（仍有未映射行，由未映射异常阻塞）`,
      );
      return { shipped: false, erpStatus };
    }
    if (
      items.some(
        (item: OrderItemEntity) =>
          item.fulfillmentStatus === 'RESERVED' || item.fulfillmentStatus === 'PICKED',
      )
    ) {
      // 内部履约进行中：货可能还在我们仓内，是否自动关账留给人判
      // （双轴差异协议，orders.md §7a.8 / §8A）。缺货部分已收敛，订单
      // 不再被缺货阻塞；重算让 rollup 反映剩下的行事实。
      const erpStatus = await this.statusService.recomputeOrderStatus(
        order.id,
        operator,
        `${reason}（内部履约进行中，留待运营处理平台差异）`,
      );
      return { shipped: false, erpStatus };
    }
    if (order.erpStatus === 'CANCELLED') {
      return { shipped: false, erpStatus: 'CANCELLED' };
    }
    if (order.erpStatus === 'SHIPPED') {
      return { shipped: true, erpStatus: 'SHIPPED' };
    }
    await this.statusService.transition(order.id, 'SHIPPED', operator, reason);
    return { shipped: true, erpStatus: 'SHIPPED' };
  }
}
