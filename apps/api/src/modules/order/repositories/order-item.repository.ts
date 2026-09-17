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

  /** Items with resolved sku codes for detail views (no N+1). */
  async findByOrderIdWithSku(
    orderId: string,
  ): Promise<Array<{ item: OrderItemEntity; skuCode: string; skuName: string }>> {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT i.*, s.sku_code AS sku_code, s.name_zh AS sku_name
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
    }>
  > {
    const query = this.dataSource
      .getRepository(OrderItemEntity)
      .createQueryBuilder('item')
      .innerJoin('item.order', 'order')
      .select(['item.id', 'item.orderId', 'item.platformSkuId'])
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
