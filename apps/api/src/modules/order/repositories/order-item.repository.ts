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
        listingSkuId: (row['listing_sku_id'] as string | null) ?? null,
        skuId: (row['sku_id'] as string | null) ?? null,
        warehouseId: (row['warehouse_id'] as string | null) ?? null,
        quantity: String(row['quantity']),
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
