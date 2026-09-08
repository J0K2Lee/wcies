import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { InventoryReservationEntity } from '../entities/inventory-reservation.entity';
import { InventoryReservationLineEntity } from '../entities/inventory-reservation-line.entity';
import { ReservationStatus, ReservationReferenceType } from '../enums/inventory.constants';
import { rawStr } from '../../../common/utils/raw';

export interface ReservationListFilters {
  skuId?: string;
  warehouseId?: string;
  status?: ReservationStatus;
  referenceType?: string;
  referenceId?: string;
}

/** Data access for reservations and their per-bin lines (queries + locks only). */
@Injectable()
export class InventoryReservationRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Business number from the dedicated PG sequence: RSV000001, RSV000002... */
  async nextReservationNo(runner: QueryRunner): Promise<string> {
    const result = (await runner.query(
      `SELECT nextval('inventory_reservation_no_seq') AS no`,
    )) as Array<{ no: string }>;
    return `RSV${result[0]!.no.padStart(8, '0')}`;
  }

  async findById(id: string): Promise<InventoryReservationEntity | null> {
    return this.dataSource.getRepository(InventoryReservationEntity).findOneBy({ id });
  }

  /** Locks the header row FOR UPDATE (lifecycle ops serialize here, task §30). */
  async lockById(runner: QueryRunner, id: string): Promise<InventoryReservationEntity | null> {
    return runner.manager
      .getRepository(InventoryReservationEntity)
      .createQueryBuilder('r')
      .where('r.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  async findByIdempotencyKey(key: string): Promise<InventoryReservationEntity | null> {
    return this.dataSource
      .getRepository(InventoryReservationEntity)
      .findOneBy({ idempotencyKey: key });
  }

  /** In-transaction re-check AFTER balance locks are held (task §61). */
  async findByIdempotencyKeyTx(
    runner: QueryRunner,
    key: string,
  ): Promise<InventoryReservationEntity | null> {
    return runner.manager
      .getRepository(InventoryReservationEntity)
      .findOneBy({ idempotencyKey: key });
  }

  async insert(
    runner: QueryRunner,
    header: {
      reservationNo: string;
      skuId: string;
      warehouseId: string;
      referenceType: ReservationReferenceType;
      referenceId: string;
      requestedQty: string;
      status: ReservationStatus;
      idempotencyKey: string;
      remark: string | null;
    },
    lines: Array<{ binId: string; quantity: string }>,
  ): Promise<InventoryReservationEntity> {
    const repository = runner.manager.getRepository(InventoryReservationEntity);
    const created = await repository.save(repository.create({ ...header }));
    // Lines are inserted explicitly (no relational cascade) so each bin
    // allocation is persisted even under concurrent inserts (task §25).
    const lineRepository = runner.manager.getRepository(InventoryReservationLineEntity);
    if (lines.length > 0) {
      await lineRepository.insert(
        lines.map((line) =>
          lineRepository.create({
            reservationId: created.id,
            binId: line.binId,
            quantity: line.quantity,
            pickedQty: '0.000',
            status: 'ACTIVE' as const,
          }),
        ),
      );
    }
    return created;
  }

  async updateStatus(
    runner: QueryRunner,
    id: string,
    patch: Partial<
      Pick<InventoryReservationEntity, 'status' | 'pickedAt' | 'releasedAt' | 'consumedAt'>
    >,
  ): Promise<void> {
    await runner.manager
      .getRepository(InventoryReservationEntity)
      .update({ id }, { ...patch, updatedAt: new Date() });
  }

  async findLines(reservationId: string): Promise<InventoryReservationLineEntity[]> {
    return this.dataSource
      .getRepository(InventoryReservationLineEntity)
      .find({ where: { reservationId }, order: { createdAt: 'ASC' } });
  }

  /** In-transaction read on the runner's own connection (pool discipline). */
  async findLinesTx(
    runner: QueryRunner,
    reservationId: string,
  ): Promise<InventoryReservationLineEntity[]> {
    return runner.manager.getRepository(InventoryReservationLineEntity).find({
      where: { reservationId },
      order: { createdAt: 'ASC' },
    });
  }

  async findLinesLocked(
    runner: QueryRunner,
    reservationId: string,
  ): Promise<InventoryReservationLineEntity[]> {
    return runner.manager
      .getRepository(InventoryReservationLineEntity)
      .createQueryBuilder('l')
      .where('l.reservationId = :reservationId', { reservationId })
      .orderBy('l.createdAt', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
  }

  async updateLine(
    runner: QueryRunner,
    lineId: string,
    patch: Partial<Pick<InventoryReservationLineEntity, 'status' | 'pickedQty' | 'shippedQty'>>,
  ): Promise<void> {
    await runner.manager
      .getRepository(InventoryReservationLineEntity)
      .update({ id: lineId }, { ...patch, updatedAt: new Date() });
  }

  async list(
    filters: ReservationListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: InventoryReservationEntity[]; total: number }> {
    const qb = this.dataSource.getRepository(InventoryReservationEntity).createQueryBuilder('r');
    if (filters.skuId !== undefined) {
      qb.andWhere('r.skuId = :skuId', { skuId: filters.skuId });
    }
    if (filters.warehouseId !== undefined) {
      qb.andWhere('r.warehouseId = :warehouseId', { warehouseId: filters.warehouseId });
    }
    if (filters.status !== undefined) {
      qb.andWhere('r.status = :status', { status: filters.status });
    }
    if (filters.referenceType !== undefined) {
      qb.andWhere('r.referenceType = :referenceType', { referenceType: filters.referenceType });
    }
    if (filters.referenceId !== undefined) {
      qb.andWhere('r.referenceId = :referenceId', { referenceId: filters.referenceId });
    }
    qb.orderBy('r.createdAt', 'DESC').skip(offset).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  /** List with sku/warehouse codes resolved in the same query (no N+1). */
  async listWithRefs(
    filters: ReservationListFilters,
    limit: number,
    offset: number,
  ): Promise<{
    rows: Array<{
      reservation: InventoryReservationEntity;
      skuCode: string;
      warehouseCode: string;
    }>;
    total: number;
  }> {
    const qb = this.dataSource
      .getRepository(InventoryReservationEntity)
      .createQueryBuilder('r')
      .innerJoin('skus', 'sku', 'sku.id = r.sku_id')
      .innerJoin('warehouses', 'wh', 'wh.id = r.warehouse_id')
      .addSelect('sku.sku_code', 'sku_code')
      .addSelect('wh.warehouse_code', 'warehouse_code');
    if (filters.skuId !== undefined) {
      qb.andWhere('r.skuId = :skuId', { skuId: filters.skuId });
    }
    if (filters.warehouseId !== undefined) {
      qb.andWhere('r.warehouseId = :warehouseId', { warehouseId: filters.warehouseId });
    }
    if (filters.status !== undefined) {
      qb.andWhere('r.status = :status', { status: filters.status });
    }
    if (filters.referenceType !== undefined) {
      qb.andWhere('r.referenceType = :referenceType', { referenceType: filters.referenceType });
    }
    if (filters.referenceId !== undefined) {
      qb.andWhere('r.referenceId = :referenceId', { referenceId: filters.referenceId });
    }
    qb.orderBy('r.createdAt', 'DESC').skip(offset).take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    return {
      rows: entities.map((reservation, index) => ({
        reservation,
        skuCode: rawStr(rawList[index]?.['sku_code']),
        warehouseCode: rawStr(rawList[index]?.['warehouse_code']),
      })),
      total,
    };
  }
}
