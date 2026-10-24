import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * SKU 引用改指（2026-10-24，SKU 合并功能）。
 *
 * 合并两个「其实是同一件实物」的 SKU 档案时，其他模块里指向源 SKU 的业务行
 * （订单行、采购明细、拣货行…）都要改指到目标 SKU。跨模块不得直接碰对方的表
 * （AGENTS.md §9），所以用**进程内注册**：各模块自己实现 relink，注册到本注册表，
 * 合并服务在一个事务里逐个调用。
 *
 * 与 `InventoryStockListenerRegistry` 同一套无模块环的做法：注册表本身不依赖任何
 * 业务模块，消费方（各模块）单向依赖它。
 */
export interface SkuReferenceRelink {
  /** 模块/表名，用于审计与错误信息（如 `order_items`）。 */
  readonly name: string;
  /**
   * 在调用方事务内把本模块引用 `sourceSkuId` 的行改指 `targetSkuId`，
   * 返回改动的行数。实现方只碰自己的表。
   */
  relink(manager: EntityManager, sourceSkuId: string, targetSkuId: string): Promise<number>;
  /** 预览：本模块引用该 SKU 的行数（只读，用于合并前展示影响面）。 */
  countReferences(skuId: string): Promise<number>;
}

@Injectable()
export class SkuReferenceRegistry {
  private readonly handlers: SkuReferenceRelink[] = [];

  register(handler: SkuReferenceRelink): void {
    if (this.handlers.some((existing) => existing.name === handler.name)) {
      return;
    }
    this.handlers.push(handler);
  }

  /** 逐个统计引用行数，返回「模块名 → 行数」。 */
  async countAll(sourceSkuId: string): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const handler of this.handlers) {
      result[handler.name] = await handler.countReferences(sourceSkuId);
    }
    return result;
  }

  /** 逐个执行改指，返回「模块名 → 改动行数」。 */
  async relinkAll(
    manager: EntityManager,
    sourceSkuId: string,
    targetSkuId: string,
  ): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const handler of this.handlers) {
      result[handler.name] = await handler.relink(manager, sourceSkuId, targetSkuId);
    }
    return result;
  }
}
