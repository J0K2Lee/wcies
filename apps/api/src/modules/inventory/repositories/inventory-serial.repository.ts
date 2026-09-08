import { Injectable } from '@nestjs/common';
import { DataSource, In, QueryRunner } from 'typeorm';
import { InventorySerialEntity } from '../entities/inventory-serial.entity';
import { InventorySerialStatus } from '../enums/inventory.constants';

/**
 * Data access for serial-tracked units (queries + locks only). All mutating
 * calls run on a QueryRunner owned by the caller's transaction so serial
 * state stays consistent with inventory_balances in ONE transaction
 * (Sprint 3 task §43).
 */
@Injectable()
export class InventorySerialRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Inserts received serials; throws PG 23505 on a duplicate serial_number. */
  async insertMany(
    runner: QueryRunner,
    rows: Array<{
      serialNumber: string;
      skuId: string;
      warehouseId: string;
      binId: string;
      status: InventorySerialStatus;
      reservationId?: string | null;
    }>,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const repository = runner.manager.getRepository(InventorySerialEntity);
    await repository.insert(
      rows.map((row) =>
        repository.create({
          serialNumber: row.serialNumber,
          skuId: row.skuId,
          warehouseId: row.warehouseId,
          binId: row.binId,
          status: row.status,
          reservationId: row.reservationId ?? null,
        }),
      ),
    );
  }

  /**
   * Locks IN_STOCK serials of one sku+bin (ordered by serial_number) and
   * returns at most `units` of them for reservation assignment.
   */
  async lockInStockByBin(
    runner: QueryRunner,
    input: { skuId: string; warehouseId: string; binId: string; units: bigint },
  ): Promise<InventorySerialEntity[]> {
    if (input.units <= 0n) {
      return [];
    }
    return runner.manager
      .getRepository(InventorySerialEntity)
      .createQueryBuilder('s')
      .where('s.skuId = :skuId', { skuId: input.skuId })
      .andWhere('s.warehouseId = :warehouseId', { warehouseId: input.warehouseId })
      .andWhere('s.binId = :binId', { binId: input.binId })
      .andWhere('s.status = :status', { status: 'IN_STOCK' })
      .orderBy('s.serialNumber', 'ASC')
      .limit(Number(input.units))
      .setLock('pessimistic_write')
      .getMany();
  }

  /** Locks specific serials by number (scan path validates ownership/status). */
  async lockBySerialNumbers(
    runner: QueryRunner,
    serialNumbers: string[],
  ): Promise<InventorySerialEntity[]> {
    if (serialNumbers.length === 0) {
      return [];
    }
    return runner.manager
      .getRepository(InventorySerialEntity)
      .createQueryBuilder('s')
      .where('s.serialNumber IN (:...serialNumbers)', { serialNumbers })
      .setLock('pessimistic_write')
      .getMany();
  }

  async findByReservationId(
    reservationId: string,
    status?: InventorySerialStatus,
  ): Promise<InventorySerialEntity[]> {
    const where: Record<string, unknown> = { reservationId };
    if (status !== undefined) {
      where.status = status;
    }
    return this.dataSource.getRepository(InventorySerialEntity).find({
      where,
      order: { serialNumber: 'ASC' },
    });
  }

  async updateMany(
    runner: QueryRunner,
    ids: string[],
    patch: Partial<
      Pick<InventorySerialEntity, 'status' | 'reservationId' | 'pickingTaskItemId' | 'binId'>
    >,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await runner.manager
      .getRepository(InventorySerialEntity)
      .update({ id: In(ids) }, { ...patch, updatedAt: new Date() });
  }

  /** All serials of a reservation with the given status, on the runner's connection. */
  async findByReservationIdTx(
    runner: QueryRunner,
    reservationId: string,
    status: InventorySerialStatus,
  ): Promise<InventorySerialEntity[]> {
    return runner.manager.getRepository(InventorySerialEntity).find({
      where: { reservationId, status },
      order: { serialNumber: 'ASC' },
    });
  }
}
