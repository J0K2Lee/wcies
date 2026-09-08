import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrderInterceptionEntity } from '../entities/order-interception.entity';
import { rawStr } from '../../../common/utils/raw';

export interface InterceptionListFilters {
  orderId?: string;
  warehouseId?: string;
  status?: string;
}

/** Data access for interception rows. */
@Injectable()
export class OrderInterceptionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async nextInterceptionNo(manager: EntityManager): Promise<string> {
    const result = (await manager.query<Array<{ no: string }>>(
      `SELECT nextval('order_interception_no_seq') AS no`,
    )) as Array<{ no: string }>;
    return `ITC${result[0]!.no.padStart(8, '0')}`;
  }

  async insert(
    manager: EntityManager,
    row: {
      interceptionNo: string;
      orderId: string;
      orderItemId: string | null;
      warehouseId: string;
      reason: string | null;
    },
  ): Promise<OrderInterceptionEntity> {
    const repository = manager.getRepository(OrderInterceptionEntity);
    return repository.save(repository.create({ ...row, status: 'CREATED' }));
  }

  async findById(id: string): Promise<OrderInterceptionEntity | null> {
    return this.dataSource.getRepository(OrderInterceptionEntity).findOneBy({ id });
  }

  /** Locks the row FOR UPDATE on the caller's transaction (manager may be a
   * transaction-scoped EntityManager; the lock joins that transaction). */
  async lockById(manager: EntityManager, id: string): Promise<OrderInterceptionEntity | null> {
    return manager
      .getRepository(OrderInterceptionEntity)
      .createQueryBuilder('i')
      .where('i.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  async update(
    manager: EntityManager,
    id: string,
    patch: Partial<
      Pick<
        OrderInterceptionEntity,
        | 'status'
        | 'assignedTo'
        | 'assignedToName'
        | 'assignedAt'
        | 'targetBinId'
        | 'scannedSkuId'
        | 'scannedSerialNumbers'
        | 'scannedAt'
        | 'interceptedAt'
        | 'returnedToStockAt'
        | 'closedAt'
        | 'failedAt'
        | 'failedReason'
      >
    >,
  ): Promise<void> {
    await manager
      .getRepository(OrderInterceptionEntity)
      .update({ id }, { ...patch, updatedAt: new Date() });
  }

  async listByOrderId(orderId: string): Promise<OrderInterceptionEntity[]> {
    return this.dataSource
      .getRepository(OrderInterceptionEntity)
      .find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }

  /** List with order/sku/warehouse refs resolved in one query (no N+1). */
  async listWithRefs(
    filters: InterceptionListFilters,
    limit: number,
    offset: number,
  ): Promise<{
    rows: Array<{
      interception: OrderInterceptionEntity;
      orderNo: string;
      warehouseCode: string;
      warehouseName: string;
      skuCode: string;
      skuName: string;
    }>;
    total: number;
  }> {
    const qb = this.dataSource
      .getRepository(OrderInterceptionEntity)
      .createQueryBuilder('i')
      .innerJoin('orders', 'o', 'o.id = i.order_id')
      .innerJoin('warehouses', 'wh', 'wh.id = i.warehouse_id')
      .leftJoin('order_items', 'oi', 'oi.id = i.order_item_id')
      .leftJoin('skus', 'sku', 'sku.id = oi.sku_id')
      .addSelect('o.order_no', 'order_no')
      .addSelect('wh.warehouse_code', 'warehouse_code')
      .addSelect('wh.name', 'warehouse_name')
      .addSelect('sku.sku_code', 'sku_code')
      .addSelect('sku.name_zh', 'sku_name');
    if (filters.orderId !== undefined) {
      qb.andWhere('i.orderId = :orderId', { orderId: filters.orderId });
    }
    if (filters.warehouseId !== undefined) {
      qb.andWhere('i.warehouseId = :warehouseId', { warehouseId: filters.warehouseId });
    }
    if (filters.status !== undefined) {
      qb.andWhere('i.status = :status', { status: filters.status });
    }
    qb.orderBy('i.createdAt', 'DESC').skip(offset).take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    return {
      rows: entities.map((interception, index) => ({
        interception,
        orderNo: rawStr(rawList[index]?.['order_no']),
        warehouseCode: rawStr(rawList[index]?.['warehouse_code']),
        warehouseName: rawStr(rawList[index]?.['warehouse_name']),
        skuCode: rawStr(rawList[index]?.['sku_code']),
        skuName: rawStr(rawList[index]?.['sku_name']),
      })),
      total,
    };
  }
}
