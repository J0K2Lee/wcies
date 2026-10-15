import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  InventoryStockListenerRegistry,
  StockIncreasedEvent,
  StockIncreasedListener,
} from '../../inventory/services/inventory-stock-listener-registry';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OrderRepository } from '../repositories/order.repository';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderIngestionService } from './order-ingestion.service';
import { OrderStatusService } from './order-status.service';
import { OrderIngestInvalidError } from '../errors/order.errors';
import { isPlatformShippedStage } from '../enums/order.constants';

/** 自动重新分配使用的系统操作者（操作日志/状态历史可追溯为 automation）。 */
const SYSTEM_OPERATOR: OperatorContext = {
  userId: null,
  username: 'auto-reallocation',
};

/** 单个 sku:warehouse 通道的并发闸（同进程内防踩踏；跨连接靠预留幂等键）。 */
const MAX_IN_FLIGHT = 8;

/**
 * 库存流水触发的自动重新分配（用户指示 2026-09-17）：
 *
 * 库存事件（INITIAL_STOCK / RECEIVE / TRANSFER_IN，2026-10-15 起含 MOVE_BIN
 * ——移位上架是「货已就位」心智时点，也覆盖配置修复后的自愈）产生后，
 * 找到该 SKU「已映射但未持有库存」的订单行（BACKORDERED + 历史卡住的
 * MAPPED+PENDING），按先进先出逐行尝试通过 InventoryService 重新预留：
 * - 成功：行转 RESERVED，关闭该行的 OPEN ORDER_OUT_OF_STOCK 异常，重算
 *   订单 rollup；
 * - 失败（仍不足）：静默保留缺货状态——不重复制造异常（人工「已到货重试」
 *   与采购到货自动重试共用底层的 allocateMappedItem 幂等预留）；
 * - 配置性失败（店铺未绑定仓库等）：写入行级 ORDER_INVALID_STATE 异常，
 *   订单行直接可见，占用成功后自动关闭（用户指示 2026-10-15 可见化）；
 * - 平台已事实发货（stage IN_TRANSIT / DELIVERED，用户指示 2026-10-14）的
 *   订单跳过：货物已发走，占库存会被现实否证，行交由同步链路收敛。
 *
 * 失败自吞：库存主流程永远不因重分配失败而回滚（AGENTS.md §10）。
 */
@Injectable()
export class OrderAutoReallocationService implements StockIncreasedListener, OnModuleInit {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly listenerRegistry: InventoryStockListenerRegistry,
    private readonly itemRepo: OrderItemRepository,
    private readonly orderRepo: OrderRepository,
    private readonly ingestionService: OrderIngestionService,
    private readonly statusService: OrderStatusService,
    private readonly exceptionService: ExceptionService,
    private readonly logger: AppLoggerService,
  ) {}

  onModuleInit(): void {
    this.listenerRegistry.register(this);
  }

  /** 库存写入方回调：自吞一切错误（不得影响库存主流程）。 */
  onStockIncreased(event: StockIncreasedEvent): void {
    const key = `${event.skuId}:${event.warehouseId}`;
    if (this.inFlight.size >= MAX_IN_FLIGHT || this.inFlight.has(key)) {
      // 同通道已在跑（或系统饱和）：本次忽略——下一笔库存流水或人工重试兜底。
      return;
    }
    this.inFlight.add(key);
    void this.reallocateFor(event)
      .catch((error: unknown) => {
        this.logger.warn(
          `auto reallocation failed sku=${event.skuId} warehouse=${event.warehouseId}: ${String(error)}`,
          'OrderAutoReallocationService',
        );
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
  }

  private async reallocateFor(event: StockIncreasedEvent): Promise<void> {
    const candidates = await this.itemRepo.findUnallocatedItemIdsBySku(event.skuId);
    if (candidates.length === 0) {
      return;
    }
    let reserved = 0;
    const ordersWithSuccess = new Set<string>();
    for (const candidate of candidates) {
      const order = await this.orderRepo.findById(candidate.orderId);
      if (order === null || order.erpStatus === 'CANCELLED' || order.erpStatus === 'SHIPPED') {
        continue;
      }
      // 平台已事实发货（用户指示 2026-10-14）：货物在平台侧已经发走，
      // 占内部库存会被现实否证——RESERVED 会随已发货订单把库存锁死。
      // 行保持缺货直至同步链路按平台事实收敛（转外部履约完成）。
      if (isPlatformShippedStage(order.platformStage)) {
        continue;
      }
      const item = await this.itemRepo.findById(candidate.itemId);
      if (
        item === null ||
        item.skuId === null ||
        (item.fulfillmentStatus !== 'BACKORDERED' && item.fulfillmentStatus !== 'PENDING')
      ) {
        continue;
      }
      try {
        const outcome = await this.ingestionService.allocateMappedItem(
          order,
          item,
          SYSTEM_OPERATOR,
        );
        if (!outcome.reserved) {
          // 仍不足：保留缺货事实，不再刷异常（首次缺货时已建 ORDER_OUT_OF_STOCK）。
          continue;
        }
        reserved += 1;
        ordersWithSuccess.add(candidate.orderId);
        await this.closeStockException(order, item);
        await this.closeConfigFailureException(order, item);
      } catch (error: unknown) {
        // 配置性失败（用户指示 2026-10-15 可见化）：店铺未绑定仓库这类"修好
        // 配置即可恢复"的问题，静默会让"收了货却占不到"无从排查——写入行级
        // ORDER_INVALID_STATE（订单行异常列/详情异常 Tab 直接可见，含修复指
        // 引），占用成功时自动关闭。其余错误维持静默（库存主流程不受影响）。
        if (error instanceof OrderIngestInvalidError) {
          await this.raisedConfigFailure(order, item, error);
          continue;
        }
        throw error;
      }
    }
    if (reserved > 0) {
      for (const orderId of ordersWithSuccess) {
        await this.statusService.recomputeOrderStatus(
          orderId,
          SYSTEM_OPERATOR,
          `库存增加后自动重新分配成功（SKU ${event.skuId}）`,
        );
      }
      this.logger.log(
        `auto reallocation reserved ${reserved} line(s) for sku=${event.skuId} ` +
          `warehouse=${event.warehouseId} (${event.eventType})`,
        'OrderAutoReallocationService',
      );
    }
  }

  private async closeStockException(order: OrderEntity, item: OrderItemEntity): Promise<void> {
    try {
      await this.exceptionService.resolveByReference({
        exceptionType: 'ORDER_OUT_OF_STOCK',
        referenceType: 'ORDER_ITEM',
        referenceId: item.id,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `auto reallocation: closing stock exception failed for ${order.orderNo} line ${item.lineNo}: ${String(error)}`,
        'OrderAutoReallocationService',
      );
    }
  }

  /** 配置性失败可见化（2026-10-15）：upsert 行级 ORDER_INVALID_STATE，自吞失败。 */
  private async raisedConfigFailure(
    order: OrderEntity,
    item: OrderItemEntity,
    error: OrderIngestInvalidError,
  ): Promise<void> {
    try {
      await this.exceptionService.upsertOpen({
        exceptionType: 'ORDER_INVALID_STATE',
        severity: 'HIGH',
        referenceType: 'ORDER_ITEM',
        referenceId: item.id,
        storeId: order.storeId,
        message:
          `库存增加后自动占用失败：${error.message}。` +
          '修复配置后对该订单行手动「重新尝试分配」即可占用（占用成功后本异常自动关闭）。',
        details: {
          orderNo: order.orderNo,
          lineNo: item.lineNo,
          skuId: item.skuId,
          reason: error.message,
        },
      });
    } catch (upsertError: unknown) {
      this.logger.warn(
        `auto reallocation: raising config-failure exception failed for ${order.orderNo} line ${item.lineNo}: ${String(upsertError)}`,
        'OrderAutoReallocationService',
      );
    }
    this.logger.warn(
      `auto reallocation: config failure for ${order.orderNo} line ${item.lineNo}: ${error.message}`,
      'OrderAutoReallocationService',
    );
  }

  /** 占用成功后关闭配置性失败异常（幂等，无则不动；自吞失败）。 */
  private async closeConfigFailureException(
    order: OrderEntity,
    item: OrderItemEntity,
  ): Promise<void> {
    try {
      await this.exceptionService.resolveByReference({
        exceptionType: 'ORDER_INVALID_STATE',
        referenceType: 'ORDER_ITEM',
        referenceId: item.id,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `auto reallocation: closing config-failure exception failed for ${order.orderNo} line ${item.lineNo}: ${String(error)}`,
        'OrderAutoReallocationService',
      );
    }
  }
}
