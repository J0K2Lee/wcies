import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderItemFulfillmentStatus, OrderItemMappingStatus } from '../enums/order.constants';

/** Data access for order items (queries + status patches only). */
@Injectable()
export class OrderItemRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findById(id: string): Promise<OrderItemEntity | null> {
    return this.dataSource.getRepository(OrderItemEntity).findOneBy({ id });
  }

  /** In-transaction read on the caller's connection (pool discipline). */
  async findByIdTx(manager: EntityManager, id: string): Promise<OrderItemEntity | null> {
    return manager.getRepository(OrderItemEntity).findOneBy({ id });
  }

  async findByOrderId(orderId: string): Promise<OrderItemEntity[]> {
    return this.dataSource
      .getRepository(OrderItemEntity)
      .find({ where: { orderId }, order: { lineNo: 'ASC' } });
  }

  /**
   * 自动重新分配候选（用户指示 2026-09-17；排序 2026-10-16 ADR 0022）：
   * 某个 SKU 可售增加后，「已映射但未持有库存」的行（BACKORDERED，或历史
   * 卡住的 MAPPED+PENDING）是重试对象。仅返回行 id + 订单 id 的轻量映射，
   * 订单头过滤在服务层。
   *
   * 排序（用户指示 2026-10-16「加急优先、平台>发货时限」）：
   *   1) 加急置顶  2) 平台优先级（platforms.priority，小=优先）
   *   3) 发货时限（早者优先，NULL 最后）  4) 行入库时间兜底（FIFO 稳定）
   *
   * 仓库过滤：只有「事件仓库（货实际进了哪个仓）被该订单店铺 ACTIVE 绑定」
   * 的行才参与竞争——一个仓的到货只可能满足它服务的店铺的订单，其余订单
   * 在别的仓收多少货都轮不到它。这是半连接，只收窄候选、不改变分配目标仓
   * （分配仍走店铺默认仓 resolveDefaultWarehouseId），故不会把货占错仓。
   */
  async findUnallocatedItemIdsBySku(
    skuId: string,
    warehouseId: string,
  ): Promise<Array<{ itemId: string; orderId: string }>> {
    const rows = await this.dataSource.query<Array<{ item_id: string; order_id: string }>>(
      `SELECT i.id AS item_id, i.order_id AS order_id
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
         JOIN stores s ON s.id = o.store_id
         JOIN platforms p ON p.id = s.platform_id
        WHERE i.sku_id = $1::uuid
          AND i.mapping_status = 'MAPPED'
          AND i.fulfillment_status IN ('BACKORDERED', 'PENDING')
          AND o.erp_status NOT IN ('CANCELLED', 'SHIPPED')
          AND EXISTS (
            SELECT 1 FROM warehouse_platform_bindings b
             WHERE b.store_id = o.store_id
               AND b.warehouse_id = $2::uuid
               AND b.status = 'ACTIVE'
          )
        ORDER BY o.is_urgent DESC,
                 p.priority ASC,
                 o.shipment_deadline ASC NULLS LAST,
                 i.created_at ASC`,
      [skuId, warehouseId],
    );
    return rows.map((row) => ({ itemId: row.item_id, orderId: row.order_id }));
  }

  /**
   * 映射修复批量收敛（2026-10-15 bug 修复）的候选行：同店铺 mapping_status =
   * 'FAILED' 且平台标识匹配该变体的行。宽松超集——标识 OR 匹配，精确判定
   * 交给逐行 resolver（resolve 不过的行保持 FAILED）。
   */
  async findFailedMappingLineCandidates(
    storeId: string,
    platformSkuId: string | null,
    sellerSku: string | null,
    limit: number,
  ): Promise<Array<{ itemId: string; orderId: string }>> {
    const rows = await this.dataSource.query<Array<{ item_id: string; order_id: string }>>(
      `SELECT i.id AS item_id, i.order_id AS order_id
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
        WHERE i.mapping_status = 'FAILED'
          AND o.store_id = $1::uuid
          AND (
            ($2::text IS NOT NULL AND i.platform_sku_id = $2)
            OR ($3::text IS NOT NULL AND i.seller_sku = $3)
          )
        ORDER BY i.created_at ASC
        LIMIT $4`,
      [storeId, platformSkuId, sellerSku, limit],
    );
    return rows.map((row) => ({ itemId: String(row.item_id), orderId: String(row.order_id) }));
  }

  /**
   * 兜底收敛的候选行（2026-10-20）：本店铺所有仍未映射、且订单未终结的行。
   * 变体级收敛只在「映射写入」时触发，历史遗留行（映射建立早于该功能）或
   * 任何遗漏的写入路径只能靠人工逐单重试；订单同步末尾用这个候选集做有界
   * 兜底扫描，把已可解析的行自动收敛。最旧优先，长期积压也能轮到。
   */
  async findFailedMappingItemIds(storeId: string, limit: number): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ item_id: string }>>(
      `SELECT i.id AS item_id
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
        WHERE i.mapping_status = 'FAILED'
          AND o.store_id = $1::uuid
          AND o.erp_status <> 'CANCELLED'
          AND i.fulfillment_status <> 'SHIPPED'
        ORDER BY i.created_at ASC
        LIMIT $2`,
      [storeId, limit],
    );
    return rows.map((row) => String(row.item_id));
  }

  /** Items with resolved sku codes for detail views (no N+1). */
  async findByOrderIdWithSku(orderId: string): Promise<
    Array<{
      item: OrderItemEntity;
      skuCode: string;
      skuName: string;
      latestPurchasePrice: string | null;
    }>
  > {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT i.*, s.sku_code AS sku_code, s.name_zh AS sku_name,
              s.latest_purchase_price AS latest_purchase_price
         FROM order_items i
         LEFT JOIN skus s ON s.id = i.sku_id
        WHERE i.order_id = $1::uuid
        ORDER BY i.line_no ASC`,
      [orderId],
    );
    const repository = this.dataSource.getRepository(OrderItemEntity);
    return rows.map((row) => {
      const item = repository.create({
        id: String(row['id']),
        orderId: String(row['order_id']),
        lineNo: Number(row['line_no']),
        platformProductId: (row['platform_product_id'] as string | null) ?? null,
        platformSkuId: (row['platform_sku_id'] as string | null) ?? null,
        sellerSku: (row['seller_sku'] as string | null) ?? null,
        offerId: (row['offer_id'] as string | null) ?? null,
        platformImageUrl: (row['platform_image_url'] as string | null) ?? null,
        listingSkuId: (row['listing_sku_id'] as string | null) ?? null,
        skuId: (row['sku_id'] as string | null) ?? null,
        warehouseId: (row['warehouse_id'] as string | null) ?? null,
        quantity: String(row['quantity']),
        unitPrice: (row['unit_price'] as string | null) ?? null,
        totalPrice: (row['total_price'] as string | null) ?? null,
        fulfillmentStatus: String(row['fulfillment_status']) as OrderItemFulfillmentStatus,
        mappingStatus: String(row['mapping_status']) as OrderItemMappingStatus,
        reservationId: (row['reservation_id'] as string | null) ?? null,
        rawData: (row['raw_data'] as Record<string, unknown> | null) ?? null,
      });
      return {
        item,
        skuCode: (row['sku_code'] as string | null) ?? '',
        skuName: (row['sku_name'] as string | null) ?? '',
        // 主数据操作者维护的最近采购价（master-data.md §4.3），非移动平均。
        latestPurchasePrice: (row['latest_purchase_price'] as string | null) ?? null,
      };
    });
  }

  async findMissingPlatformImages(
    storeId: string,
    orderId?: string,
  ): Promise<
    Array<{
      id: string;
      orderId: string;
      platformSkuId: string | null;
      /** Yandex 行的取图键（= offerId，mapper 写入）；OZON 行为 null。 */
      sellerSku: string | null;
    }>
  > {
    const query = this.dataSource
      .getRepository(OrderItemEntity)
      .createQueryBuilder('item')
      .innerJoin('item.order', 'order')
      .select(['item.id', 'item.orderId', 'item.platformSkuId', 'item.sellerSku'])
      .where('order.storeId = :storeId', { storeId })
      .andWhere('item.skuId IS NULL AND item.platformImageUrl IS NULL');
    if (orderId !== undefined) query.andWhere('item.orderId = :orderId', { orderId });
    return query.orderBy('item.id', 'ASC').getMany();
  }

  /** Compare-and-set prevents a concurrent mapping/backfill from being overwritten. */
  async savePlatformImages(
    storeId: string,
    images: readonly { orderItemId: string; imageUrl: string }[],
  ): Promise<string[]> {
    if (images.length === 0) return [];
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `WITH updated AS (
         UPDATE order_items i SET platform_image_url = v.image_url, updated_at = NOW()
         FROM jsonb_to_recordset($2::jsonb) AS v(id uuid, image_url text), orders o
         WHERE i.id = v.id AND i.order_id = o.id AND o.store_id = $1::uuid
           AND i.sku_id IS NULL AND i.platform_image_url IS NULL RETURNING i.id
       ) SELECT id FROM updated`,
      [
        storeId,
        JSON.stringify(
          images.map((image) => ({ id: image.orderItemId, image_url: image.imageUrl })),
        ),
      ],
    );
    return rows.map((row) => row.id);
  }

  async updateMapping(
    manager: EntityManager,
    id: string,
    patch: {
      mappingStatus: OrderItemMappingStatus;
      skuId?: string | null;
      listingSkuId?: string | null;
    },
  ): Promise<void> {
    await manager.getRepository(OrderItemEntity).update(
      { id },
      {
        mappingStatus: patch.mappingStatus,
        ...(patch.skuId !== undefined ? { skuId: patch.skuId } : {}),
        ...(patch.listingSkuId !== undefined ? { listingSkuId: patch.listingSkuId } : {}),
        updatedAt: new Date(),
      },
    );
  }

  async updateFulfillment(
    manager: EntityManager,
    id: string,
    patch: {
      fulfillmentStatus: OrderItemFulfillmentStatus;
      reservationId?: string | null;
      warehouseId?: string | null;
    },
  ): Promise<void> {
    await manager.getRepository(OrderItemEntity).update(
      { id },
      {
        fulfillmentStatus: patch.fulfillmentStatus,
        ...(patch.reservationId !== undefined ? { reservationId: patch.reservationId } : {}),
        ...(patch.warehouseId !== undefined ? { warehouseId: patch.warehouseId } : {}),
        updatedAt: new Date(),
      },
    );
  }
}
