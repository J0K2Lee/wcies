import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DomainError } from '../../../common/errors/domain.error';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { SkuMergeInventoryService } from '../../inventory/services/sku-merge-inventory.service';
import { SkuReferenceRegistry } from './sku-reference.registry';

export class SkuMergeInvalidRequestError extends DomainError {
  readonly code = 'SKU_MERGE_INVALID_REQUEST';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

export class SkuNotFoundForMergeError extends DomainError {
  readonly code = 'SKU_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(identifier: string) {
    super(`SKU 不存在：${identifier}`, { identifier });
  }
}

export class SkuMergeConfirmMismatchError extends DomainError {
  readonly code = 'SKU_MERGE_CONFIRM_MISMATCH';
  readonly httpStatus = 422;

  constructor(expected: string) {
    super(`请准确输入目标 SKU 编码「${expected}」以确认合并`, { expected });
  }
}

export interface SkuMergePreviewDto {
  source: { id: string; skuCode: string; nameZh: string; status: string };
  target: { id: string; skuCode: string; nameZh: string; status: string };
  /** 各来源的引用行数（模块名 → 行数），用于展示影响面。 */
  references: Record<string, number>;
  product: {
    platformMappings: number;
    barcodes: number;
    /** 与目标已有条码重复、合并时会丢弃的源条码数 */
    duplicateBarcodes: number;
    images: number;
    bundleAsBundle: number;
    bundleAsComponent: number;
    /** 套装组件冲突（目标已有同一组件），合并时保留目标的 */
    bundleConflicts: number;
  };
  inventory: {
    balances: number;
    onHandQty: string;
    reservedQty: string;
    pickedQty: string;
    reservations: number;
    serials: number;
    safetyStocks: number;
    transactions: number;
  };
}

export interface SkuMergeResultDto {
  mergedSourceSkuCode: string;
  targetSkuId: string;
  targetSkuCode: string;
  references: Record<string, number>;
  inventory: {
    balances: number;
    absorbedOnHand: string;
    absorbedReserved: string;
    absorbedPicked: string;
    reservations: number;
    serials: number;
    safetyStocks: number;
    transactions: number;
    replayedTransactions: number;
  };
  barcodesMoved: number;
  barcodesDropped: number;
  imagesMoved: number;
}

interface SkuRow {
  id: string;
  sku_code: string;
  name_zh: string;
  status: string;
  latest_purchase_price: string | null;
}

/**
 * SKU 合并（2026-10-24 用户需求）。
 *
 * 背景：运营在不同平台商品上各自快速建档，导致**同一件实物**有多个 SKU 档案。
 * 合并把它们归到一个 SKU 上：平台映射/条码/图片/业务引用全部改指目标，
 * 库存账面按身份归并（余额相加、流水重排），源 SKU 删除。
 *
 * 目标 SKU 的基础信息（名称/品牌/分类/型号/规格/成本）永远保留。
 * 只在操作员输入目标编码确认后执行；单事务，任一步失败整体回滚。
 */
@Injectable()
export class SkuMergeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: SkuReferenceRegistry,
    private readonly inventoryMerge: SkuMergeInventoryService,
    private readonly operationLog: OperationLogService,
  ) {}

  async preview(sourceId: string, targetSkuId: string): Promise<SkuMergePreviewDto> {
    const [source, target] = await this.loadPair(this.dataSource.manager, sourceId, targetSkuId);
    return this.buildPreview(source, target);
  }

  async merge(
    sourceId: string,
    targetSkuId: string,
    confirmSkuCode: string,
    operator: OperatorContext,
  ): Promise<SkuMergeResultDto> {
    const result = await this.dataSource.transaction(async (manager) => {
      const [source, target] = await this.loadPair(manager, sourceId, targetSkuId);
      if (confirmSkuCode.trim() !== target.sku_code) {
        throw new SkuMergeConfirmMismatchError(target.sku_code);
      }

      // 1) 条码：先丢弃与目标重复的（条码全局唯一），再把主条码冲突降级。
      const dropped = await this.count(
        manager,
        `SELECT count(*)::int AS n FROM sku_barcodes s
          WHERE s.sku_id = $1::uuid
            AND EXISTS (SELECT 1 FROM sku_barcodes t
                         WHERE t.barcode = s.barcode AND t.sku_id <> s.sku_id)`,
        [source.id],
      );
      await manager.query(
        `DELETE FROM sku_barcodes s
          WHERE s.sku_id = $1::uuid
            AND EXISTS (SELECT 1 FROM sku_barcodes t
                         WHERE t.barcode = s.barcode AND t.sku_id <> s.sku_id)`,
        [source.id],
      );
      await manager.query(
        `UPDATE sku_barcodes SET is_primary = false
          WHERE sku_id = $1::uuid AND is_primary
            AND EXISTS (SELECT 1 FROM sku_barcodes t
                         WHERE t.sku_id = $2::uuid AND t.is_primary)`,
        [source.id, target.id],
      );
      const moved = await this.updateCount(
        manager,
        `UPDATE sku_barcodes SET sku_id = $2::uuid WHERE sku_id = $1::uuid RETURNING id`,
        [source.id, target.id],
      );

      // 2) 图片：主图目标优先，源图并入。
      await manager.query(
        `UPDATE sku_images SET is_primary = false
          WHERE sku_id = $1::uuid AND is_primary
            AND EXISTS (SELECT 1 FROM sku_images t
                         WHERE t.sku_id = $2::uuid AND t.is_primary)`,
        [source.id, target.id],
      );
      const imagesMoved = await this.updateCount(
        manager,
        `UPDATE sku_images SET sku_id = $2::uuid WHERE sku_id = $1::uuid RETURNING id`,
        [source.id, target.id],
      );

      // 3) 平台映射：全部改指（一个 SKU 挂多个平台/多个链接本来就允许）。
      await this.updateCount(
        manager,
        `UPDATE platform_listing_skus SET sku_id = $2::uuid WHERE sku_id = $1::uuid RETURNING id`,
        [source.id, target.id],
      );

      // 4) 套装组件：先去重再改指（唯一键 bundle+component）。
      await manager.query(
        `DELETE FROM sku_bundle_components s
          WHERE s.bundle_sku_id = $1::uuid
            AND EXISTS (SELECT 1 FROM sku_bundle_components t
                         WHERE t.bundle_sku_id = $2::uuid
                           AND t.component_sku_id = s.component_sku_id)`,
        [source.id, target.id],
      );
      await manager.query(
        `UPDATE sku_bundle_components SET bundle_sku_id = $2::uuid
          WHERE bundle_sku_id = $1::uuid`,
        [source.id, target.id],
      );
      await manager.query(
        `DELETE FROM sku_bundle_components s
          WHERE s.component_sku_id = $1::uuid
            AND EXISTS (SELECT 1 FROM sku_bundle_components t
                         WHERE t.component_sku_id = $2::uuid
                           AND t.bundle_sku_id = s.bundle_sku_id)`,
        [source.id, target.id],
      );
      await manager.query(
        `UPDATE sku_bundle_components SET component_sku_id = $2::uuid
          WHERE component_sku_id = $1::uuid`,
        [source.id, target.id],
      );

      // 5) 成本：目标优先，为空才继承源。
      if (target.latest_purchase_price === null && source.latest_purchase_price !== null) {
        await manager.query(
          `UPDATE skus SET latest_purchase_price = $2, updated_at = now() WHERE id = $1::uuid`,
          [target.id, source.latest_purchase_price],
        );
      }

      // 6) 库存账面归并（余额/预留/序列号/安全库存/流水重排 + 终值校验）。
      const inventory = await this.inventoryMerge.mergeInTx(manager, {
        sourceSkuId: source.id,
        targetSkuId: target.id,
      });

      // 7) 其他模块的业务引用改指（各模块自己实现，注册表调度）。
      const references = await this.registry.relinkAll(manager, source.id, target.id);

      // 8) 删除源 SKU（所有引用与库存已迁走）。
      await manager.query(`DELETE FROM skus WHERE id = $1::uuid`, [source.id]);

      await this.operationLog.record({
        entityType: 'SKU',
        entityId: target.id,
        entityCode: target.sku_code,
        action: 'MERGE_SKU',
        changes: {
          mergedFrom: { from: null, to: source.sku_code },
          mergedFromName: { from: null, to: source.name_zh },
          references: { from: null, to: references },
          inventory: { from: null, to: inventory },
        },
        operator,
      });

      return {
        mergedSourceSkuCode: source.sku_code,
        targetSkuId: target.id,
        targetSkuCode: target.sku_code,
        references,
        inventory: {
          balances: inventory.balances,
          absorbedOnHand: inventory.absorbedOnHand,
          absorbedReserved: inventory.absorbedReserved,
          absorbedPicked: inventory.absorbedPicked,
          reservations: inventory.reservations,
          serials: inventory.serials,
          safetyStocks: inventory.safetyStocks,
          transactions: inventory.transactions,
          replayedTransactions: inventory.replayedTransactions,
        },
        barcodesMoved: moved,
        barcodesDropped: dropped,
        imagesMoved,
      } satisfies SkuMergeResultDto;
    });

    return result;
  }

  // -------------------------------------------------------------------------

  /**
   * 读取两个 SKU 并按 id 排序加锁（固定顺序避免并发合并互相死锁）。
   */
  private async loadPair(
    manager: EntityManager,
    sourceId: string,
    targetSkuId: string,
  ): Promise<[SkuRow, SkuRow]> {
    if (sourceId === targetSkuId) {
      throw new SkuMergeInvalidRequestError('不能把 SKU 合并到它自己');
    }
    const ids = [sourceId, targetSkuId].sort();
    const rows = await manager.query<SkuRow[]>(
      `SELECT id, sku_code, name_zh, status, latest_purchase_price
         FROM skus WHERE id = ANY($1::uuid[])
         ORDER BY id
         FOR UPDATE`,
      [ids],
    );
    const source = rows.find((row) => row.id === sourceId);
    const target = rows.find((row) => row.id === targetSkuId);
    if (source === undefined) {
      throw new SkuNotFoundForMergeError(sourceId);
    }
    if (target === undefined) {
      throw new SkuNotFoundForMergeError(targetSkuId);
    }
    return [source, target];
  }

  private async buildPreview(source: SkuRow, target: SkuRow): Promise<SkuMergePreviewDto> {
    const manager = this.dataSource.manager;
    const product = {
      platformMappings: await this.count(
        manager,
        `SELECT count(*)::int AS n FROM platform_listing_skus WHERE sku_id = $1::uuid`,
        [source.id],
      ),
      barcodes: await this.count(
        manager,
        `SELECT count(*)::int AS n FROM sku_barcodes WHERE sku_id = $1::uuid`,
        [source.id],
      ),
      duplicateBarcodes: await this.count(
        manager,
        `SELECT count(*)::int AS n FROM sku_barcodes s
          WHERE s.sku_id = $1::uuid
            AND EXISTS (SELECT 1 FROM sku_barcodes t
                         WHERE t.barcode = s.barcode AND t.sku_id <> s.sku_id)`,
        [source.id],
      ),
      images: await this.count(
        manager,
        `SELECT count(*)::int AS n FROM sku_images WHERE sku_id = $1::uuid`,
        [source.id],
      ),
      bundleAsBundle: await this.count(
        manager,
        `SELECT count(*)::int AS n FROM sku_bundle_components WHERE bundle_sku_id = $1::uuid`,
        [source.id],
      ),
      bundleAsComponent: await this.count(
        manager,
        `SELECT count(*)::int AS n FROM sku_bundle_components WHERE component_sku_id = $1::uuid`,
        [source.id],
      ),
      bundleConflicts: await this.count(
        manager,
        `SELECT count(*)::int AS n FROM sku_bundle_components s
          WHERE s.bundle_sku_id = $1::uuid
            AND EXISTS (SELECT 1 FROM sku_bundle_components t
                         WHERE t.bundle_sku_id = $2::uuid
                           AND t.component_sku_id = s.component_sku_id)`,
        [source.id, target.id],
      ),
    };

    const balanceRows = (await manager.query<
      Array<{ on_hand_qty: string; reserved_qty: string; picked_qty: string }>
    >(
      `SELECT on_hand_qty::text, reserved_qty::text, picked_qty::text
         FROM inventory_balances WHERE sku_id = $1::uuid`,
      [source.id],
    )) as Array<{ on_hand_qty: string; reserved_qty: string; picked_qty: string }>;
    const sum = (key: 'on_hand_qty' | 'reserved_qty' | 'picked_qty'): string =>
      balanceRows.reduce((acc, row) => acc + Number(row[key]), 0).toFixed(3);

    const inventory = {
      balances: balanceRows.length,
      onHandQty: sum('on_hand_qty'),
      reservedQty: sum('reserved_qty'),
      pickedQty: sum('picked_qty'),
      reservations: await this.count(
        manager,
        `SELECT count(*)::int AS n FROM inventory_reservations WHERE sku_id = $1::uuid`,
        [source.id],
      ),
      serials: await this.count(
        manager,
        `SELECT count(*)::int AS n FROM inventory_serials WHERE sku_id = $1::uuid`,
        [source.id],
      ),
      safetyStocks: await this.count(
        manager,
        `SELECT count(*)::int AS n FROM inventory_safety_stocks WHERE sku_id = $1::uuid`,
        [source.id],
      ),
      transactions: await this.count(
        manager,
        `SELECT count(*)::int AS n FROM inventory_transactions WHERE sku_id = $1::uuid`,
        [source.id],
      ),
    };

    const references = await this.registry.countAll(source.id);
    return {
      source: {
        id: source.id,
        skuCode: source.sku_code,
        nameZh: source.name_zh,
        status: source.status,
      },
      target: {
        id: target.id,
        skuCode: target.sku_code,
        nameZh: target.name_zh,
        status: target.status,
      },
      references,
      product,
      inventory,
    };
  }

  private async count(manager: EntityManager, sql: string, params: unknown[]): Promise<number> {
    const rows = await manager.query<Array<{ n: number }>>(sql, params);
    return rows[0]?.n ?? 0;
  }

  private async updateCount(
    manager: EntityManager,
    sql: string,
    params: unknown[],
  ): Promise<number> {
    const result: unknown = await manager.query(sql, params);
    if (Array.isArray(result) && Array.isArray(result[0])) {
      return (result[0] as unknown[]).length;
    }
    return Array.isArray(result) ? result.length : 0;
  }
}
