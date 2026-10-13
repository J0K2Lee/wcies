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
   * 自动重新分配候选（用户指示 2026-09-17）：某个 SKU 可售增加后，
   * 「已映射但未持有库存」的行（BACKORDERED，或历史卡住的 MAPPED+PENDING）
   * 是重试对象。仅返回行 id + 订单 id 的轻量映射，订单头过滤在服务层。
   */
  async findUnallocatedItemIdsBySku(
    skuId: string,
  ): Promise<Array<{ itemId: string; orderId: string }>> {
    const rows = await this.dataSource.query<Array<{ item_id: string; order_id: string }>>(
      `SELECT i.id AS item_id, i.order_id AS order_id
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
        WHERE i.sku_id = $1::uuid
          AND i.mapping_status = 'MAPPED'
          AND i.fulfillment_status IN ('BACKORDERED', 'PENDING')
          AND o.erp_status NOT IN ('CANCELLED', 'SHIPPED')
        ORDER BY i.created_at ASC`,
      [skuId],
    );
    return rows.map((row) => ({ itemId: row.item_id, orderId: row.order_id }));
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
