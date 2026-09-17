import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { rawStr } from '../../../common/utils/raw';
import { PurchaseOrderEntity } from '../entities/purchase-order.entity';
import { PurchaseOrderItemEntity } from '../entities/purchase-order-item.entity';
import { ProcurementState } from '../enums/purchase.constants';

export interface PurchaseOrderListFilters {
  keyword?: string;
  status?: string;
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
   * The live (non-cancelled) purchase item linked to an order line, if any.
   * Anti-duplicate-ordering relies on this staying consistent with the
   * creation transaction (purchase.md §3.4/§9).
   */
  async findActiveItemByOrderItemId(
    orderItemId: string,
    excludePoId?: string,
  ): Promise<{ item: PurchaseOrderItemEntity; order: PurchaseOrderEntity } | null> {
    const rows = await this.dataSource.query<
      Array<{
        item_id: string;
        po_no: string;
        ordered_at: Date;
        quantity: string;
        received_quantity: string;
      }>
    >(
      `SELECT i.id AS item_id, po.po_no, po.ordered_at, i.quantity, i.received_quantity
       FROM purchase_order_items i
       JOIN purchase_orders po ON po.id = i.po_id
       WHERE i.order_item_id = $1 AND po.status <> 'CANCELLED'
         AND ($2::uuid IS NULL OR po.id <> $2::uuid)
       ORDER BY po.ordered_at DESC
       LIMIT 1`,
      [orderItemId, excludePoId ?? null],
    );
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      item: {
        id: row.item_id,
        poId: '',
        skuId: '',
        orderItemId,
        quantity: row.quantity,
        unitCost: null,
        receivedQuantity: row.received_quantity,
        remark: null,
        createdAt: new Date(row.ordered_at),
        updatedAt: new Date(row.ordered_at),
      },
      order: { poNo: row.po_no, orderedAt: new Date(row.ordered_at) } as PurchaseOrderEntity,
    };
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
      );
    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere('(po.po_no ILIKE :kw OR po.source_note ILIKE :kw OR s.name ILIKE :kw)', {
        kw: `%${filters.keyword}%`,
      });
    }
    if (filters.status !== undefined) {
      qb.andWhere('po.status = :status', { status: filters.status });
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
        remark: string | null;
        sku_code: string;
        sku_name: string;
        order_no: string | null;
      }>
    >(
      `SELECT i.id, i.sku_id, i.order_item_id, i.quantity, i.unit_cost, i.received_quantity, i.remark,
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
   * Derived procurement states for order lines (purchase.md §3.5): sums the
   * linked non-cancelled items; ARRIVED once received >= ordered.
   */
  async getProcurementStatesByOrderItemIds(
    orderItemIds: readonly string[],
  ): Promise<Record<string, ProcurementState>> {
    if (orderItemIds.length === 0) {
      return {};
    }
    const rows = await this.dataSource.query<
      Array<{ order_item_id: string; total_qty: string; received_qty: string }>
    >(
      `SELECT i.order_item_id, SUM(i.quantity)::text AS total_qty, SUM(i.received_quantity)::text AS received_qty
       FROM purchase_order_items i
       JOIN purchase_orders po ON po.id = i.po_id
       WHERE po.status <> 'CANCELLED' AND i.order_item_id = ANY($1::uuid[])
       GROUP BY i.order_item_id`,
      [orderItemIds as string[]],
    );
    const states: Record<string, ProcurementState> = {};
    for (const row of rows) {
      states[row.order_item_id] =
        Number(row.received_qty) >= Number(row.total_qty) ? 'ARRIVED' : 'ORDERED';
    }
    return states;
  }

  /** Order-line ids currently linked to a non-cancelled PO (order list filter). */
  async listActiveOrderItemIds(): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ order_item_id: string }>>(
      `SELECT DISTINCT i.order_item_id
       FROM purchase_order_items i
       JOIN purchase_orders po ON po.id = i.po_id
       WHERE po.status <> 'CANCELLED' AND i.order_item_id IS NOT NULL`,
    );
    return rows.map((row) => row.order_item_id);
  }

  /** Recomputes a PO's status from its items' received quantities (T4 calls this). */
  async recomputeStatus(manager: EntityManager, poId: string): Promise<string> {
    const rows = await manager.query<Array<{ total: string; received: string }>>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS total,
              COALESCE(SUM(received_quantity), 0)::text AS received
       FROM purchase_order_items WHERE po_id = $1`,
      [poId],
    );
    const total = Number(rows[0]?.total ?? '0');
    const received = Number(rows[0]?.received ?? '0');
    if (received <= 0) {
      return 'ORDERED';
    }
    return received >= total ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
  }
}
