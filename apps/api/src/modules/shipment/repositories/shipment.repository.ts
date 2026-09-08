import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ShipmentEntity } from '../entities/shipment.entity';
import { ShipmentItemEntity } from '../entities/shipment-item.entity';
import { ShipmentStatus } from '../enums/shipment.constants';
import { rawStr } from '../../../common/utils/raw';

export interface ShipmentListFilters {
  orderId?: string;
  warehouseId?: string;
  status?: string;
  trackingNumber?: string;
}

export interface ShipmentRowWithRefs {
  shipment: ShipmentEntity;
  orderNo: string;
  warehouseCode: string;
  warehouseName: string;
  packagesCount: number;
  sealedPackagesCount: number;
  itemsTotal: number;
}

/** Data access for shipments and their item snapshots. */
@Injectable()
export class ShipmentRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Business number from the dedicated PG sequence: SHP000001... */
  async nextShipmentNo(manager: EntityManager): Promise<string> {
    const result = await manager.query<Array<{ no: string }>>(
      `SELECT nextval('shipment_no_seq') AS no`,
    );
    return `SHP${result[0]!.no.padStart(8, '0')}`;
  }

  async insertWithItems(
    manager: EntityManager,
    header: {
      shipmentNo: string;
      orderId: string;
      warehouseId: string;
      status: ShipmentStatus;
    },
    items: Array<{
      orderItemId: string;
      skuId: string;
      reservationId: string;
      quantity: string;
    }>,
  ): Promise<ShipmentEntity> {
    const repository = manager.getRepository(ShipmentEntity);
    const created = await repository.save(repository.create({ ...header }));
    const itemRepository = manager.getRepository(ShipmentItemEntity);
    if (items.length > 0) {
      await itemRepository.insert(
        items.map((item) =>
          itemRepository.create({
            shipmentId: created.id,
            orderItemId: item.orderItemId,
            skuId: item.skuId,
            reservationId: item.reservationId,
            quantity: item.quantity,
          }),
        ),
      );
    }
    return created;
  }

  async findById(id: string): Promise<ShipmentEntity | null> {
    return this.dataSource.getRepository(ShipmentEntity).findOneBy({ id });
  }

  async lockById(manager: EntityManager, id: string): Promise<ShipmentEntity | null> {
    return manager
      .getRepository(ShipmentEntity)
      .createQueryBuilder('s')
      .where('s.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  async updateStatus(
    manager: EntityManager,
    id: string,
    patch: Partial<
      Pick<
        ShipmentEntity,
        'status' | 'trackingNumber' | 'carrierCode' | 'shippingMethod' | 'shippedAt'
      >
    >,
  ): Promise<void> {
    await manager.getRepository(ShipmentEntity).update({ id }, { ...patch, updatedAt: new Date() });
  }

  async findItemsByShipmentId(shipmentId: string): Promise<ShipmentItemEntity[]> {
    return this.dataSource
      .getRepository(ShipmentItemEntity)
      .find({ where: { shipmentId }, order: { createdAt: 'ASC' } });
  }

  async findItemsByShipmentIdTx(
    manager: EntityManager,
    shipmentId: string,
  ): Promise<ShipmentItemEntity[]> {
    return manager.getRepository(ShipmentItemEntity).find({
      where: { shipmentId },
      order: { createdAt: 'ASC' },
    });
  }

  /** The live (non-cancelled) shipment an order item is assigned to, if any. */
  async findLiveShipmentOfOrderItem(orderItemId: string): Promise<{
    shipmentId: string;
    status: string;
    shippedAt: Date | null;
  } | null> {
    const rows = await this.dataSource.query<
      Array<{ shipment_id: string; status: string; shipped_at: Date | null }>
    >(
      `SELECT s.id AS shipment_id, s.status, s.shipped_at
         FROM shipment_items si
         JOIN shipments s ON s.id = si.shipment_id
        WHERE si.order_item_id = $1::uuid
          AND s.status <> 'CANCELLED'
        LIMIT 1`,
      [orderItemId],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : { shipmentId: row.shipment_id, status: row.status, shippedAt: row.shipped_at };
  }

  async removeShipmentItem(manager: EntityManager, orderItemId: string): Promise<void> {
    await manager.getRepository(ShipmentItemEntity).delete({ orderItemId });
  }

  /** List with order/warehouse refs and package aggregates (no N+1). */
  async listWithAggregates(
    filters: ShipmentListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ShipmentRowWithRefs[]; total: number }> {
    const qb = this.dataSource
      .getRepository(ShipmentEntity)
      .createQueryBuilder('s')
      .innerJoin('orders', 'o', 'o.id = s.order_id')
      .innerJoin('warehouses', 'wh', 'wh.id = s.warehouse_id')
      .addSelect('o.order_no', 'order_no')
      .addSelect('wh.warehouse_code', 'warehouse_code')
      .addSelect('wh.name', 'warehouse_name')
      .addSelect(
        (subQuery) =>
          subQuery
            .select('COUNT(*)')
            .from('packages', 'p')
            .where('p.shipment_id = s.id AND p.status <> :cancelled'),
        'packages_count',
      )
      .addSelect(
        (subQuery) =>
          subQuery
            .select('COUNT(*)')
            .from('packages', 'p')
            .where('p.shipment_id = s.id AND p.status = :sealed'),
        'sealed_packages_count',
      )
      .addSelect(
        (subQuery) =>
          subQuery.select('COUNT(*)').from('shipment_items', 'si').where('si.shipment_id = s.id'),
        'items_total',
      )
      .setParameters({ cancelled: 'CANCELLED', sealed: 'SEALED' });
    if (filters.orderId !== undefined) {
      qb.andWhere('s.orderId = :orderId', { orderId: filters.orderId });
    }
    if (filters.warehouseId !== undefined) {
      qb.andWhere('s.warehouseId = :warehouseId', { warehouseId: filters.warehouseId });
    }
    if (filters.status !== undefined) {
      qb.andWhere('s.status = :status', { status: filters.status });
    }
    if (filters.trackingNumber !== undefined && filters.trackingNumber !== '') {
      qb.andWhere('s.trackingNumber ILIKE :tracking', { tracking: `%${filters.trackingNumber}%` });
    }
    qb.orderBy('s.createdAt', 'DESC').skip(offset).take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    return {
      rows: entities.map((shipment, index) => ({
        shipment,
        orderNo: rawStr(rawList[index]?.['order_no']),
        warehouseCode: rawStr(rawList[index]?.['warehouse_code']),
        warehouseName: rawStr(rawList[index]?.['warehouse_name']),
        packagesCount: Number(rawList[index]?.['packages_count'] ?? 0),
        sealedPackagesCount: Number(rawList[index]?.['sealed_packages_count'] ?? 0),
        itemsTotal: Number(rawList[index]?.['items_total'] ?? 0),
      })),
      total,
    };
  }
}
