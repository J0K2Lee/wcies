import { Injectable } from '@nestjs/common';
import { InventoryEventType } from '../enums/inventory.constants';

/** 库存增加事件的载荷：哪个 SKU / 仓库的可售变多了。 */
export interface StockIncreasedEvent {
  skuId: string;
  warehouseId: string;
  eventType: InventoryEventType;
}

/** 订单模块等消费方实现的回调；失败必须自吞，不得影响库存主流程。 */
export interface StockIncreasedListener {
  onStockIncreased(event: StockIncreasedEvent): void;
}

/**
 * 库存模块的进程内事件出口（用户指示 2026-09-17：有库存流水发生时自动
 * 重新分配缺货订单行）。
 *
 * - 不引入新依赖：一个极薄的注册表，订单模块在模块初始化时注册监听器，
 *   规避 Inventory ↔ Order 的模块环（AGENTS.md §7/§9）。
 * - 监听器在「同一进程、独立连接」上异步执行：库存写入方的事务提交前，
 *   监听器的后续 FOR UPDATE 会在余额行锁上自然等待提交——事务回滚时
 *   预留同样失败，两个方向都安全。
 * - 未注册监听器时为 no-op（库存功能不依赖订单模块存在）。
 */
@Injectable()
export class InventoryStockListenerRegistry {
  private listener: StockIncreasedListener | null = null;

  register(listener: StockIncreasedListener): void {
    this.listener = listener;
  }

  /** 消费方（InventoryService）在写入增加流水后调用；fire-and-forget。 */
  emitStockIncreased(event: StockIncreasedEvent): void {
    const current = this.listener;
    if (current === null) {
      return;
    }
    // 同步回调里抛错不能打断库存事务/主流程。
    try {
      current.onStockIncreased(event);
    } catch {
      // swallowed: listener owns its error handling.
    }
  }
}
