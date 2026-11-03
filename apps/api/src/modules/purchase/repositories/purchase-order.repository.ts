import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { rawStr } from '../../../common/utils/raw';
import { PurchaseOrderEntity } from '../entities/purchase-order.entity';
import { PurchaseOrderItemEntity } from '../entities/purchase-order-item.entity';

export interface PurchaseOrderListFilters {
  keyword?: string;
  status?: string;
  statuses?: string[];
  supplierId?: string;
  orderItemId?: string;
  orderedFrom?: Date;
  orderedTo?: Date;
}

export interface PurchaseOrderRowWithRefs {
  order: PurchaseOrderEntity;
  supplierName: string | null;
  itemCount: number;
  totalQuantity: string;
  /** 明细第一行（created_at, id）的 SKU 编码 / 名称 / 数量（列表「采购商品」列）。 */
  firstItemSkuCode: string | null;
  firstItemName: string | null;
  firstItemQuantity: string | null;
  /** 短装结案数量合计（2026-11-03，列表标签用）。 */
  closedQuantity: string;
}

export interface PurchaseOrderItemWithRefs {
  item: PurchaseOrderItemEntity;
  skuCode: string;
  skuName: string;
  orderNo: string | null;
}

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class PurchaseOrderRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findById(id: string): Promise<PurchaseOrderEntity | null> {
    return this.dataSource.getRepository(PurchaseOrderEntity).findOneBy({ id });
  }

  async lockById(manager: EntityManager, id: string): Promise<PurchaseOrderEntity | null> {
    return manager.getRepository(PurchaseOrderEntity).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async findItemsInTx(manager: EntityManager, poId: string): Promise<PurchaseOrderItemEntity[]> {
    return manager.getRepository(PurchaseOrderItemEntity).find({
      where: { poId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * 删除前的下游事实检查（用户指示 2026-10-17 批量删除）：是否存在**已入库**
   * 的收货单（`RECEIVED`）或已收数量。命中即禁止删除——收货确认已经产生库存
   * 流水，删除单据会让账实与流水失去凭证（AGENTS.md §14/§39）。
   *
   * 在事务内、锁住 PO 之后调用；`purchase_orders` 行锁串行化并发的取消/确认。
   */
  async hasReceivingFacts(manager: EntityManager, poId: string): Promise<boolean> {
    const rows = await manager.query<Array<{ blocked: boolean }>>(
      `SELECT (
         EXISTS (SELECT 1 FROM purchase_receipts r
                  WHERE r.purchase_order_id = $1 AND r.status = 'RECEIVED')
         OR EXISTS (SELECT 1 FROM purchase_order_items i
                     WHERE i.po_id = $1 AND i.received_quantity > 0)
       ) AS blocked`,
      [poId],
    );
    return rows[0]?.blocked === true;
  }

  /**
   * 物理删除采购单：先删其**未入库**收货单（DRAFT/CANCELLED，明细由 FK
   * ON DELETE CASCADE 带走），再删采购单（明细同样级联）。
   *
   * 调用方必须已在同一事务内通过 `hasReceivingFacts` 守卫——这里对收货单
   * 加状态过滤是第二道防线：即便有并发确认溜过检查，`RECEIVED` 单也不会被删，
   * 随后的 PO 删除会因 FK 失败而整体回滚，不会产生半删状态。
   */
  async deleteWithUnreceivedReceipts(manager: EntityManager, poId: string): Promise<void> {
    await manager.query(
      `DELETE FROM purchase_receipts
        WHERE purchase_order_id = $1 AND status IN ('DRAFT', 'CANCELLED')`,
      [poId],
    );
    await manager.query(`DELETE FROM purchase_orders WHERE id = $1`, [poId]);
  }

  /** Header + items in ONE transaction (purchase.md §3.3). */
  async insertWithItems(
    manager: EntityManager,
    header: {
      poNo: string;
      supplierId: string | null;
      sourceNote: string | null;
      status: 'ORDERED';
      orderedAt: Date;
      expectedAt: Date | null;
      remark: string | null;
      createdBy: string | null;
      receivingWarehouseId: string;
    },
    items: Array<{
      skuId: string;
      orderItemId: string | null;
      quantity: string;
      unitCost: string | null;
      remark: string | null;
    }>,
  ): Promise<PurchaseOrderEntity> {
    const repository = manager.getRepository(PurchaseOrderEntity);
    const created = await repository.save(repository.create({ ...header }));
    const itemRepository = manager.getRepository(PurchaseOrderItemEntity);
    if (items.length > 0) {
      await itemRepository.insert(
        items.map((item) => ({
          poId: created.id,
          skuId: item.skuId,
          orderItemId: item.orderItemId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          receivedQuantity: '0.000',
          remark: item.remark,
        })),
      );
    }
    return created;
  }

  async updateHeader(
    manager: EntityManager,
    id: string,
    patch: Partial<PurchaseOrderEntity>,
  ): Promise<void> {
    await manager
      .getRepository(PurchaseOrderEntity)
      .update({ id }, { ...patch, updatedAt: new Date() });
  }

  /** Full item replace - only legal while ORDERED (received_quantity is 0). */
  async replaceItems(
    manager: EntityManager,
    poId: string,
    items: Array<{
      skuId: string;
      orderItemId: string | null;
      quantity: string;
      unitCost: string | null;
      remark: string | null;
    }>,
  ): Promise<void> {
    const itemRepository = manager.getRepository(PurchaseOrderItemEntity);
    await itemRepository.delete({ poId });
    if (items.length > 0) {
      await itemRepository.insert(
        items.map((item) => ({
          poId,
          skuId: item.skuId,
          orderItemId: item.orderItemId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          receivedQuantity: '0.000',
          remark: item.remark,
        })),
      );
    }
  }

  async list(
    filters: PurchaseOrderListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: PurchaseOrderRowWithRefs[]; total: number }> {
    const qb = this.dataSource
      .getRepository(PurchaseOrderEntity)
      .createQueryBuilder('po')
      .leftJoin('suppliers', 's', 's.id = po.supplier_id')
      .addSelect('s.name', 'supplier_name')
      .addSelect(
        `(SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = po.id)`,
        'item_count',
      )
      .addSelect(
        `(SELECT COALESCE(SUM(i.quantity), 0) FROM purchase_order_items i WHERE i.po_id = po.id)`,
        'total_quantity',
      )
      // 短装结案标签（2026-11-03）：RECEIVED 且该值 > 0 时列表显示「短装结案」。
      .addSelect(
        `(SELECT COALESCE(SUM(i.closed_quantity), 0) FROM purchase_order_items i WHERE i.po_id = po.id)`,
        'closed_quantity_total',
      )
      // 列表「采购商品」列（用户指示 2026-10-17）：明细第一行（created_at, id）
      // 的 SKU 名称 / 编码 / 数量。三个相关子查询都走 idx_purchase_order_items_po，
      // 每页 20 行成本可忽略；与详情页 findItemsWithRefs 同一排序口径。
      .addSelect(
        `(SELECT sk.sku_code FROM purchase_order_items i
             JOIN skus sk ON sk.id = i.sku_id
            WHERE i.po_id = po.id
            ORDER BY i.created_at, i.id
            LIMIT 1)`,
        'first_item_sku_code',
      )
      .addSelect(
        `(SELECT sk.name_zh FROM purchase_order_items i
             JOIN skus sk ON sk.id = i.sku_id
            WHERE i.po_id = po.id
            ORDER BY i.created_at, i.id
            LIMIT 1)`,
        'first_item_name',
      )
      .addSelect(
        `(SELECT i.quantity FROM purchase_order_items i
            WHERE i.po_id = po.id
            ORDER BY i.created_at, i.id
            LIMIT 1)`,
        'first_item_quantity',
      );
    if (filters.keyword !== undefined && filters.keyword !== '') {
      // 搜索覆盖明细 SKU（用户指示 2026-10-17）：搜 "A7" / "玄影" 能命中
      // 含该 SKU 的采购单，而不只是 PO号 / 货源说明 / 供应商。
      qb.andWhere(
        `(po.po_no ILIKE :kw OR po.source_note ILIKE :kw OR s.name ILIKE :kw
          OR EXISTS (
            SELECT 1 FROM purchase_order_items i
              JOIN skus sk ON sk.id = i.sku_id
             WHERE i.po_id = po.id
               AND (sk.sku_code ILIKE :kw OR sk.name_zh ILIKE :kw)
          ))`,
        { kw: `%${filters.keyword}%` },
      );
    }
    if (filters.status !== undefined) {
      qb.andWhere('po.status = :status', { status: filters.status });
    }
    if (filters.statuses !== undefined && filters.statuses.length > 0) {
      qb.andWhere('po.status IN (:...statuses)', { statuses: filters.statuses });
    }
    if (filters.supplierId !== undefined) {
      qb.andWhere('po.supplier_id = :supplierId', { supplierId: filters.supplierId });
    }
    if (filters.orderedFrom !== undefined) {
      qb.andWhere('po.ordered_at >= :orderedFrom', { orderedFrom: filters.orderedFrom });
    }
    if (filters.orderedTo !== undefined) {
      qb.andWhere('po.ordered_at <= :orderedTo', { orderedTo: filters.orderedTo });
    }
    if (filters.orderItemId !== undefined) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.po_id = po.id AND i.order_item_id = :orderItemId)`,
        { orderItemId: filters.orderItemId },
      );
    }
    qb.orderBy('po.orderedAt', 'DESC').skip(offset).take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    return {
      rows: entities.map((order, index) => ({
        order,
        supplierName: (rawList[index]?.['supplier_name'] as string | null) ?? null,
        itemCount: Number(rawList[index]?.['item_count'] ?? 0),
        totalQuantity: rawStr(rawList[index]?.['total_quantity']) || '0',
        firstItemSkuCode: (rawList[index]?.['first_item_sku_code'] as string | null) ?? null,
        firstItemName: (rawList[index]?.['first_item_name'] as string | null) ?? null,
        firstItemQuantity: (rawList[index]?.['first_item_quantity'] as string | null) ?? null,
        closedQuantity: rawStr(rawList[index]?.['closed_quantity_total']) || '0',
      })),
      total,
    };
  }

  async findItemsWithRefs(poId: string): Promise<PurchaseOrderItemWithRefs[]> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        sku_id: string;
        order_item_id: string | null;
        quantity: string;
        unit_cost: string | null;
        received_quantity: string;
        closed_quantity: string;
        remark: string | null;
        sku_code: string;
        sku_name: string;
        order_no: string | null;
      }>
    >(
      `SELECT i.id, i.sku_id, i.order_item_id, i.quantity, i.unit_cost, i.received_quantity,
              i.closed_quantity, i.remark,
              sk.sku_code, sk.name_zh AS sku_name, o.order_no
       FROM purchase_order_items i
       JOIN skus sk ON sk.id = i.sku_id
       LEFT JOIN order_items oi ON oi.id = i.order_item_id
       LEFT JOIN orders o ON o.id = oi.order_id
       WHERE i.po_id = $1
       ORDER BY i.created_at, i.id`,
      [poId],
    );
    return rows.map((row) => ({
      item: {
        id: row.id,
        poId,
        skuId: row.sku_id,
        orderItemId: row.order_item_id,
        quantity: row.quantity,
        unitCost: row.unit_cost,
        receivedQuantity: row.received_quantity,
        closedQuantity: row.closed_quantity,
        closedAt: null,
        closedBy: null,
        closeReason: null,
        remark: row.remark,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      skuCode: row.sku_code,
      skuName: row.sku_name,
      orderNo: row.order_no,
    }));
  }

  /**
   * Recomputes a PO's status from its items (T4 calls this).
   *
   * 2026-11-03：计入短装结案 `closed_quantity`——供应商不再发的部分由操作员
   * 结案后，采购单必须能收口到 RECEIVED，否则会永久停在 PARTIALLY_RECEIVED
   * 并让在途虚增（补货守卫因此拒绝新采购）。
   */
  async recomputeStatus(manager: EntityManager, poId: string): Promise<string> {
    const rows = await manager.query<Array<{ total: string; received: string; closed: string }>>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS total,
              COALESCE(SUM(received_quantity), 0)::text AS received,
              COALESCE(SUM(closed_quantity), 0)::text AS closed
       FROM purchase_order_items WHERE po_id = $1`,
      [poId],
    );
    const total = Number(rows[0]?.total ?? '0');
    const received = Number(rows[0]?.received ?? '0');
    const closed = Number(rows[0]?.closed ?? '0');
    if (received <= 0 && closed <= 0) {
      return 'ORDERED';
    }
    return received + closed >= total ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
  }

  /**
   * 短装结案：把某行的一部分「不会再发货」的数量关掉（2026-11-03）。
   *
   * SQL 层的 `closed_quantity + $2 <= quantity - received_quantity` 是并发兜底
   * （两个操作员同时结案时只有一个能成功），与 DB CHECK 一起保证不超关。
   * 返回受影响行数：0 = 条件不满足（已收/已关完或超额）。
   */
  async closeRemaining(
    manager: EntityManager,
    poItemId: string,
    quantity: string,
    reason: string,
    operatorId: string | null,
  ): Promise<number> {
    const result = await manager.query<Array<{ id: string }>>(
      `UPDATE purchase_order_items
          SET closed_quantity = closed_quantity + $2::numeric,
              closed_at = now(),
              closed_by = $4,
              close_reason = $3,
              updated_at = now()
        WHERE id = $1
          AND closed_quantity + $2::numeric <= quantity - received_quantity
        RETURNING id`,
      [poItemId, quantity, reason, operatorId],
    );
    return result.length;
  }
}
