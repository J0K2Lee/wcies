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
 * - **必须在库存事务提交之后调用**（2026-10-17 实测修复）。监听器在
 *   「同一进程、独立连接」上异步执行；旧注释假设"FOR UPDATE 会等待提交"，
 *   但那只对**已存在**的余额行成立——首次入库到某个库位时余额行是本次事务
 *   INSERT 的，未提交前对监听器的连接**根本不可见**，于是被误判为库存不足、
 *   缺货行不会自动分配（真实样本 ORD00000219 / SKU000012012）。
 *   现在由各入口在 commit 之后广播：`addStock` 自行处理，
 *   `receiveStockInTx` / `transferInInTx` 的调用方负责提交后逐条广播。
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
