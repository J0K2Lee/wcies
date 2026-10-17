import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, Not, QueryRunner } from 'typeorm';
import { rawStr } from '../../../common/utils/raw';
import { PurchaseReceiptEntity } from '../entities/purchase-receipt.entity';
import { PurchaseReceiptItemEntity } from '../entities/purchase-receipt-item.entity';

export interface PurchaseReceiptListFilters {
  keyword?: string;
  status?: string;
  warehouseId?: string;
  purchaseOrderId?: string;
}

export interface PurchaseReceiptRowWithRefs {
  receipt: PurchaseReceiptEntity;
  purchaseOrderNo: string | null;
  supplierName: string | null;
  warehouseCode: string | null;
  itemCount: number;
  totalQuantity: string;
  /** 明细第一行（created_at, id）的 SKU 编码 / 名称 / 数量（列表「采购商品」列）。 */
  firstItemSkuCode: string | null;
  firstItemName: string | null;
  firstItemQuantity: string | null;
}

export interface PurchaseReceiptItemWithRefs {
  item: PurchaseReceiptItemEntity;
  skuCode: string;
  skuName: string;
  binCode: string | null;
}

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class PurchaseReceiptRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findById(id: string): Promise<PurchaseReceiptEntity | null> {
    return this.dataSource.getRepository(PurchaseReceiptEntity).findOneBy({ id });
  }

  /** Lock matching drafts before cancellation, in the same order as confirmation. */
  async findDraftsByPurchaseOrderId(
    manager: EntityManager,
    purchaseOrderId: string,
  ): Promise<PurchaseReceiptEntity[]> {
    return manager.getRepository(PurchaseReceiptEntity).find({
      where: { purchaseOrderId, status: 'DRAFT' },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * The live (non-cancelled) receipts of a PO. Drives draft-generation
   * dedupe (决策 0021): generating a second draft for a PO that already has
   * one is refused rather than silently producing overlapping documents.
   */
  async findActiveByPurchaseOrderId(purchaseOrderId: string): Promise<PurchaseReceiptEntity[]> {
    return this.dataSource.getRepository(PurchaseReceiptEntity).find({
      where: { purchaseOrderId, status: Not('CANCELLED') },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * 事务内锁行并回读状态（删除守卫用）：`FOR UPDATE` 与并发的确认/取消串行化，
   * 避免「查到 DRAFT → 并发 confirm → 删掉已入库单据」的窗口。
   * 返回 null 表示单据不存在。
   */
  async lockStatusInTx(manager: EntityManager, id: string): Promise<string | null> {
    const rows = await manager.query<Array<{ status: string }>>(
      `SELECT status FROM purchase_receipts WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0]?.status ?? null;
  }

  /**
   * 物理删除收货单（用户指示 2026-10-17 批量删除）：明细由 FK ON DELETE
   * CASCADE 带走。调用方必须在同一事务内锁行并确认状态为 DRAFT/CANCELLED
   * ——`RECEIVED` 的收货单已产生库存流水，删除会让账实失去凭证。
   * 这里再加状态过滤是第二道防线（并发确认溜过检查时留下 RECEIVED 单）。
   *
   * 用 QueryBuilder 的 delete（`affected`）而不是裸 SQL + RETURNING：
   * TypeORM 的 `UPDATE/DELETE ... RETURNING` 经 raw query 返回
   * `[rows, rowCount]` 二元组，直接把结果当行数组会让守卫永远"成功"。
   */
  async deleteIfUnreceived(manager: EntityManager, id: string): Promise<boolean> {
    const result = await manager
      .getRepository(PurchaseReceiptEntity)
      .delete({ id, status: In(['DRAFT', 'CANCELLED']) });
    return (result.affected ?? 0) > 0;
  }

  /** Row lock inside the confirm transaction (status re-check, §4.3). */
  async lockById(runner: QueryRunner, id: string): Promise<PurchaseReceiptEntity | null> {
    const rows = (await runner.query(`SELECT * FROM purchase_receipts WHERE id = $1 FOR UPDATE`, [
      id,
    ])) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0]!;
    return this.dataSource.getRepository(PurchaseReceiptEntity).create({
      id: String(row['id']),
      receiptNo: String(row['receipt_no']),
      purchaseOrderId: (row['purchase_order_id'] as string | null) ?? null,
      supplierId: (row['supplier_id'] as string | null) ?? null,
      sourceNote: (row['source_note'] as string | null) ?? null,
      warehouseId: String(row['warehouse_id']),
      status: String(row['status']) as PurchaseReceiptEntity['status'],
      receivedAt: row['received_at'] === null ? null : new Date(row['received_at'] as string),
      remark: (row['remark'] as string | null) ?? null,
      createdBy: (row['created_by'] as string | null) ?? null,
      createdAt: new Date(row['created_at'] as string),
      updatedAt: new Date(row['updated_at'] as string),
    });
  }

  async insertWithItems(
    manager: EntityManager,
    header: {
      receiptNo: string;
      purchaseOrderId: string | null;
      supplierId: string | null;
      sourceNote: string | null;
      warehouseId: string;
      status: 'DRAFT';
      remark: string | null;
      createdBy: string | null;
    },
    items: Array<{
      purchaseOrderItemId: string | null;
      skuId: string;
      quantity: string;
      unitCost: string | null;
      binId: string | null;
      serialNumbers: string[] | null;
      remark: string | null;
    }>,
  ): Promise<PurchaseReceiptEntity> {
    const repository = manager.getRepository(PurchaseReceiptEntity);
    const created = await repository.save(repository.create({ ...header }));
    const itemRepository = manager.getRepository(PurchaseReceiptItemEntity);
    if (items.length > 0) {
      await itemRepository.insert(
        items.map((item) => ({
          receiptId: created.id,
          purchaseOrderItemId: item.purchaseOrderItemId,
          skuId: item.skuId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          binId: item.binId,
          serialNumbers: item.serialNumbers,
          remark: item.remark,
        })),
      );
    }
    return created;
  }

  async updateHeader(
    manager: EntityManager,
    id: string,
    patch: Partial<PurchaseReceiptEntity>,
  ): Promise<void> {
    await manager
      .getRepository(PurchaseReceiptEntity)
      .update({ id }, { ...patch, updatedAt: new Date() });
  }

  /** Full item replace - only legal while DRAFT (nothing booked yet). */
  async replaceItems(
    manager: EntityManager,
    receiptId: string,
    items: Array<{
      purchaseOrderItemId: string | null;
      skuId: string;
      quantity: string;
      unitCost: string | null;
      binId: string | null;
      serialNumbers: string[] | null;
      remark: string | null;
    }>,
  ): Promise<void> {
    const itemRepository = manager.getRepository(PurchaseReceiptItemEntity);
    await itemRepository.delete({ receiptId });
    if (items.length > 0) {
      await itemRepository.insert(
        items.map((item) => ({
          receiptId,
          purchaseOrderItemId: item.purchaseOrderItemId,
          skuId: item.skuId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          binId: item.binId,
          serialNumbers: item.serialNumbers,
          remark: item.remark,
        })),
      );
    }
  }

  async list(
    filters: PurchaseReceiptListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: PurchaseReceiptRowWithRefs[]; total: number }> {
    const qb = this.dataSource
      .getRepository(PurchaseReceiptEntity)
      .createQueryBuilder('pr')
      .leftJoin('purchase_orders', 'po', 'po.id = pr.purchase_order_id')
      .leftJoin('suppliers', 's', 's.id = pr.supplier_id')
      .leftJoin('warehouses', 'w', 'w.id = pr.warehouse_id')
      .addSelect('po.po_no', 'purchase_order_no')
      .addSelect('s.name', 'supplier_name')
      .addSelect('w.warehouse_code', 'warehouse_code')
      .addSelect(
        `(SELECT COUNT(*) FROM purchase_receipt_items i WHERE i.receipt_id = pr.id)`,
        'item_count',
      )
      .addSelect(
        `(SELECT COALESCE(SUM(i.quantity), 0) FROM purchase_receipt_items i WHERE i.receipt_id = pr.id)`,
        'total_quantity',
      )
      // 列表「采购商品」列（用户指示 2026-10-17）：同采购单列表，取明细第一行。
      .addSelect(
        `(SELECT sk.sku_code FROM purchase_receipt_items i
             JOIN skus sk ON sk.id = i.sku_id
            WHERE i.receipt_id = pr.id
            ORDER BY i.created_at, i.id
            LIMIT 1)`,
        'first_item_sku_code',
      )
      .addSelect(
        `(SELECT sk.name_zh FROM purchase_receipt_items i
             JOIN skus sk ON sk.id = i.sku_id
            WHERE i.receipt_id = pr.id
            ORDER BY i.created_at, i.id
            LIMIT 1)`,
        'first_item_name',
      )
      .addSelect(
        `(SELECT i.quantity FROM purchase_receipt_items i
            WHERE i.receipt_id = pr.id
            ORDER BY i.created_at, i.id
            LIMIT 1)`,
        'first_item_quantity',
      );
    if (filters.keyword !== undefined && filters.keyword !== '') {
      // 搜索覆盖明细 SKU（用户指示 2026-10-17）：同采购单列表。
      qb.andWhere(
        `(pr.receipt_no ILIKE :kw OR pr.source_note ILIKE :kw
          OR EXISTS (
            SELECT 1 FROM purchase_receipt_items i
              JOIN skus sk ON sk.id = i.sku_id
             WHERE i.receipt_id = pr.id
               AND (sk.sku_code ILIKE :kw OR sk.name_zh ILIKE :kw)
          ))`,
        { kw: `%${filters.keyword}%` },
      );
    }
    if (filters.status !== undefined) {
      qb.andWhere('pr.status = :status', { status: filters.status });
    }
    if (filters.warehouseId !== undefined) {
      qb.andWhere('pr.warehouse_id = :warehouseId', { warehouseId: filters.warehouseId });
    }
    if (filters.purchaseOrderId !== undefined) {
      qb.andWhere('pr.purchase_order_id = :purchaseOrderId', {
        purchaseOrderId: filters.purchaseOrderId,
      });
    }
    qb.orderBy('pr.createdAt', 'DESC').skip(offset).take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    return {
      rows: entities.map((receipt, index) => ({
        receipt,
        purchaseOrderNo: (rawList[index]?.['purchase_order_no'] as string | null) ?? null,
        supplierName: (rawList[index]?.['supplier_name'] as string | null) ?? null,
        warehouseCode: (rawList[index]?.['warehouse_code'] as string | null) ?? null,
        itemCount: Number(rawList[index]?.['item_count'] ?? 0),
        totalQuantity: rawStr(rawList[index]?.['total_quantity']) || '0',
        firstItemSkuCode: (rawList[index]?.['first_item_sku_code'] as string | null) ?? null,
        firstItemName: (rawList[index]?.['first_item_name'] as string | null) ?? null,
        firstItemQuantity: (rawList[index]?.['first_item_quantity'] as string | null) ?? null,
      })),
      total,
    };
  }

  async findItemsWithRefs(receiptId: string): Promise<PurchaseReceiptItemWithRefs[]> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        purchase_order_item_id: string | null;
        sku_id: string;
        quantity: string;
        unit_cost: string | null;
        bin_id: string | null;
        serial_numbers: string[] | null;
        remark: string | null;
        sku_code: string;
        sku_name: string;
        bin_code: string | null;
      }>
    >(
      `SELECT i.id, i.purchase_order_item_id, i.sku_id, i.quantity, i.unit_cost, i.bin_id,
              i.serial_numbers, i.remark, sk.sku_code, sk.name_zh AS sku_name, b.bin_code
       FROM purchase_receipt_items i
       JOIN skus sk ON sk.id = i.sku_id
       LEFT JOIN warehouse_bins b ON b.id = i.bin_id
       WHERE i.receipt_id = $1
       ORDER BY i.created_at, i.id`,
      [receiptId],
    );
    return rows.map((row) => ({
      item: {
        id: row.id,
        receiptId,
        purchaseOrderItemId: row.purchase_order_item_id,
        skuId: row.sku_id,
        quantity: row.quantity,
        unitCost: row.unit_cost,
        binId: row.bin_id,
        serialNumbers: row.serial_numbers,
        remark: row.remark,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      skuCode: row.sku_code,
      skuName: row.sku_name,
      binCode: row.bin_code,
    }));
  }

  /** Accrues received_quantity on the source PO item inside the confirm tx. */
  async accruePoItemReceived(
    runner: QueryRunner,
    purchaseOrderItemId: string,
    quantity: string,
  ): Promise<void> {
    await runner.query(
      `UPDATE purchase_order_items
       SET received_quantity = received_quantity + $2::numeric, updated_at = now()
       WHERE id = $1`,
      [purchaseOrderItemId, quantity],
    );
  }

  /**
   * Reads the remaining receivable quantity of a PO item ON the confirm
   * transaction (决策 0021 over-receipt guard). Returns null when the item
   * row is gone; the caller then skips the check.
   */
  async findPoItemRemainingInTx(
    runner: QueryRunner,
    purchaseOrderItemId: string,
  ): Promise<{ skuCode: string; quantity: string; receivedQuantity: string } | null> {
    const rows = (await runner.query(
      `SELECT i.quantity, i.received_quantity, sk.sku_code AS sku_code
         FROM purchase_order_items i
         JOIN skus sk ON sk.id = i.sku_id
        WHERE i.id = $1`,
      [purchaseOrderItemId],
    )) as Array<{ quantity: string; received_quantity: string; sku_code: string }>;
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      skuCode: row.sku_code,
      quantity: row.quantity,
      receivedQuantity: row.received_quantity,
    };
  }
}
