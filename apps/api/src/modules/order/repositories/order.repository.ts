import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';
import { ErpOrderStatus } from '../enums/order.constants';
import { rawStr } from '../../../common/utils/raw';

export interface OrderListFilters {
  keyword?: string;
  erpStatus?: string;
  storeId?: string;
  /** Hard restriction to these order ids (待采购 filter pipeline, T3). */
  orderIds?: string[];
}

export interface OrderListRow {
  order: OrderEntity;
  storeName: string;
  platformCode: string;
  itemsCount: number;
  reservedCount: number;
  backorderedCount: number;
  pickedCount: number;
  mappingFailedCount: number;
  openExceptionsCount: number;
}

/** Data access for order headers (queries + inserts + status patches only). */
@Injectable()
export class OrderRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Business number from the dedicated PG sequence: ORD00000001... */
  async nextOrderNo(manager: EntityManager): Promise<string> {
    const result = await manager.query<Array<{ no: string }>>(
      `SELECT nextval('order_no_seq') AS no`,
    );
    return `ORD${result[0]!.no.padStart(8, '0')}`;
  }

  async findByStoreAndPlatformOrder(
    storeId: string,
    platformOrderId: string,
  ): Promise<OrderEntity | null> {
    return this.dataSource.getRepository(OrderEntity).findOneBy({ storeId, platformOrderId });
  }

  async findById(id: string): Promise<OrderEntity | null> {
    return this.dataSource.getRepository(OrderEntity).findOneBy({ id });
  }

  /**
   * Orders owning a MAPPED BACKORDERED line that no live purchase order
   * covers (待采购 view, purchase.md §3.5). `coveredOrderItemIds` comes from
   * the purchase module's port; this repo owns the order-line facts.
   */
  async findOrderIdsWithUncoveredBackorderedLines(
    coveredOrderItemIds: readonly string[],
  ): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ order_id: string }>>(
      `SELECT DISTINCT i.order_id
       FROM order_items i
       WHERE i.fulfillment_status = 'BACKORDERED'
         AND i.mapping_status = 'MAPPED'
         AND i.sku_id IS NOT NULL
         ${coveredOrderItemIds.length > 0 ? 'AND i.id != ALL($1::uuid[])' : ''}`,
      coveredOrderItemIds.length > 0 ? [[...coveredOrderItemIds]] : [],
    );
    return rows.map((row) => row.order_id);
  }

  /**
   * Creates the order + its PENDING items on the caller's transaction.
   * PG 23505 on uq_orders_store_platform must be handled by the caller
   * (concurrent duplicate ingest replays the winner, task §84).
   */
  async insertWithItems(
    manager: EntityManager,
    header: {
      orderNo: string;
      storeId: string;
      platformOrderId: string;
      platformStatus: string | null;
      erpStatus: ErpOrderStatus;
      fulfillmentMode: string | null;
      currency: string | null;
      orderedAt: Date;
      shipmentDeadline: Date | null;
      rawData: Record<string, unknown> | null;
      remark: string | null;
      syncSource: string | null;
    },
    items: Array<{
      lineNo: number;
      platformProductId: string | null;
      platformSkuId: string | null;
      sellerSku: string | null;
      offerId: string | null;
      quantity: string;
      rawData: Record<string, unknown> | null;
    }>,
  ): Promise<OrderEntity> {
    const repository = manager.getRepository(OrderEntity);
    const created = await repository.save(repository.create({ ...header }));
    const itemRepository = manager.getRepository(OrderItemEntity);
    if (items.length > 0) {
      await itemRepository.insert(
        items.map((item) => ({
          orderId: created.id,
          lineNo: item.lineNo,
          platformProductId: item.platformProductId,
          platformSkuId: item.platformSkuId,
          sellerSku: item.sellerSku,
          offerId: item.offerId,
          quantity: item.quantity,
          fulfillmentStatus: 'PENDING',
          mappingStatus: 'PENDING',
          rawData: item.rawData,
        })) as never,
      );
    }
    return created;
  }

  async updateErpStatus(
    manager: EntityManager,
    id: string,
    erpStatus: ErpOrderStatus,
  ): Promise<void> {
    await manager.getRepository(OrderEntity).update({ id }, { erpStatus, updatedAt: new Date() });
  }

  /** Paged list with aggregated row counts + open exceptions (no N+1, task §61/§90). */
  async listWithAggregates(
    filters: OrderListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: OrderListRow[]; total: number }> {
    const qb = this.dataSource
      .getRepository(OrderEntity)
      .createQueryBuilder('o')
      .innerJoin('stores', 's', 's.id = o.store_id')
      .innerJoin('platforms', 'p', 'p.id = s.platform_id')
      .addSelect('s.name', 'store_name')
      .addSelect('p.code', 'platform_code')
      .addSelect(`(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id)`, 'items_count')
      .addSelect(
        `(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.fulfillment_status = 'RESERVED')`,
        'reserved_count',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.fulfillment_status = 'BACKORDERED')`,
        'backordered_count',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.fulfillment_status = 'PICKED')`,
        'picked_count',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.mapping_status = 'FAILED')`,
        'mapping_failed_count',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM system_exceptions e
            WHERE e.status = 'OPEN'
              AND e.reference_type = 'ORDER_ITEM'
              AND e.reference_id IN (SELECT i.id FROM order_items i WHERE i.order_id = o.id))`,
        'open_exceptions_count',
      );
    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere('(o.order_no ILIKE :kw OR o.platform_order_id ILIKE :kw)', {
        kw: `%${filters.keyword}%`,
      });
    }
    if (filters.erpStatus !== undefined) {
      qb.andWhere('o.erp_status = :erpStatus', { erpStatus: filters.erpStatus });
    }
    if (filters.storeId !== undefined) {
      qb.andWhere('o.store_id = :storeId', { storeId: filters.storeId });
    }
    if (filters.orderIds !== undefined) {
      if (filters.orderIds.length === 0) {
        return { rows: [], total: 0 };
      }
      qb.andWhere('o.id IN (:...orderIds)', { orderIds: filters.orderIds });
    }
    qb.orderBy('o.orderedAt', 'DESC').skip(offset).take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    return {
      rows: entities.map((order, index) => ({
        order,
        storeName: rawStr(rawList[index]?.['store_name']),
        platformCode: rawStr(rawList[index]?.['platform_code']),
        itemsCount: Number(rawList[index]?.['items_count'] ?? 0),
        reservedCount: Number(rawList[index]?.['reserved_count'] ?? 0),
        backorderedCount: Number(rawList[index]?.['backordered_count'] ?? 0),
        pickedCount: Number(rawList[index]?.['picked_count'] ?? 0),
        mappingFailedCount: Number(rawList[index]?.['mapping_failed_count'] ?? 0),
        openExceptionsCount: Number(rawList[index]?.['open_exceptions_count'] ?? 0),
      })),
      total,
    };
  }
}
