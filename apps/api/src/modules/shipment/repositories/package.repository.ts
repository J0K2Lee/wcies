import { Injectable } from '@nestjs/common';
import { DataSource, In, EntityManager } from 'typeorm';
import { PackageEntity } from '../entities/package.entity';
import { PackageItemEntity } from '../entities/package-item.entity';
import { PackageItemSerialEntity } from '../entities/package-item-serial.entity';
import { formatQty, parseQty } from '../../../common/utils/quantity';

/** Data access for packages, their items and packed serials. */
@Injectable()
export class PackageRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Business number from the dedicated PG sequence: PKG000001... */
  async nextPackageNo(manager: EntityManager): Promise<string> {
    const result = await manager.query<Array<{ no: string }>>(
      `SELECT nextval('package_no_seq') AS no`,
    );
    return `PKG${result[0]!.no.padStart(8, '0')}`;
  }

  async insert(
    manager: EntityManager,
    row: { packageNo: string; shipmentId: string },
  ): Promise<PackageEntity> {
    const repository = manager.getRepository(PackageEntity);
    return repository.save(repository.create({ ...row, status: 'OPEN' }));
  }

  async findById(id: string): Promise<PackageEntity | null> {
    return this.dataSource.getRepository(PackageEntity).findOneBy({ id });
  }

  async lockById(manager: EntityManager, id: string): Promise<PackageEntity | null> {
    return manager
      .getRepository(PackageEntity)
      .createQueryBuilder('p')
      .where('p.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  async updateStatus(
    manager: EntityManager,
    id: string,
    patch: Partial<
      Pick<
        PackageEntity,
        | 'status'
        | 'sealedAt'
        | 'trackingNumber'
        | 'weightKg'
        | 'lengthCm'
        | 'widthCm'
        | 'heightCm'
        | 'labelFileId'
      >
    >,
  ): Promise<void> {
    await manager.getRepository(PackageEntity).update({ id }, { ...patch, updatedAt: new Date() });
  }

  async updateManyStatus(
    manager: EntityManager,
    ids: string[],
    patch: Partial<Pick<PackageEntity, 'status'>>,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await manager
      .getRepository(PackageEntity)
      .update({ id: In(ids) }, { ...patch, updatedAt: new Date() });
  }

  async listByShipmentId(shipmentId: string): Promise<PackageEntity[]> {
    return this.dataSource
      .getRepository(PackageEntity)
      .find({ where: { shipmentId }, order: { createdAt: 'ASC' } });
  }

  async listByShipmentIdTx(manager: EntityManager, shipmentId: string): Promise<PackageEntity[]> {
    return manager.getRepository(PackageEntity).find({
      where: { shipmentId },
      order: { createdAt: 'ASC' },
    });
  }

  async findItems(packageId: string): Promise<PackageItemEntity[]> {
    return this.dataSource
      .getRepository(PackageItemEntity)
      .find({ where: { packageId }, order: { createdAt: 'ASC' } });
  }

  async findItem(packageId: string, orderItemId: string): Promise<PackageItemEntity | null> {
    return this.dataSource.getRepository(PackageItemEntity).findOneBy({ packageId, orderItemId });
  }

  /** Finds a package item FOR UPDATE on the caller's transaction. */
  async lockItem(
    manager: EntityManager,
    packageId: string,
    orderItemId: string,
  ): Promise<PackageItemEntity | null> {
    return manager
      .getRepository(PackageItemEntity)
      .createQueryBuilder('pi')
      .where('pi.packageId = :packageId', { packageId })
      .andWhere('pi.orderItemId = :orderItemId', { orderItemId })
      .setLock('pessimistic_write')
      .getOne();
  }

  async insertItem(
    manager: EntityManager,
    row: { packageId: string; orderItemId: string; skuId: string; quantity: string },
  ): Promise<PackageItemEntity> {
    const repository = manager.getRepository(PackageItemEntity);
    return repository.save(repository.create({ ...row }));
  }

  async updateItemQuantity(
    manager: EntityManager,
    itemId: string,
    quantity: string,
  ): Promise<void> {
    await manager
      .getRepository(PackageItemEntity)
      .update({ id: itemId }, { quantity, updatedAt: new Date() });
  }

  async insertSerial(
    manager: EntityManager,
    row: {
      packageItemId: string;
      packageId: string;
      orderItemId: string;
      skuId: string;
      serialNumber: string;
    },
  ): Promise<void> {
    const repository = manager.getRepository(PackageItemSerialEntity);
    await repository.insert(repository.create({ ...row }));
  }

  async findSerialsOfPackage(packageId: string): Promise<PackageItemSerialEntity[]> {
    return this.dataSource.getRepository(PackageItemSerialEntity).find({
      where: { packageId },
      order: { serialNumber: 'ASC' },
    });
  }

  /** Packed serials of one order item inside a shipment (non-cancelled packages). */
  async findSerialsOfShipmentItem(
    manager: EntityManager,
    shipmentId: string,
    orderItemId: string,
  ): Promise<string[]> {
    const rows = await manager.query<Array<{ serial_number: string }>>(
      `SELECT pis.serial_number
         FROM package_item_serials pis
         JOIN packages p ON p.id = pis.package_id
        WHERE p.shipment_id = $1::uuid
          AND pis.order_item_id = $2::uuid
          AND p.status <> 'CANCELLED'
        ORDER BY pis.serial_number ASC`,
      [shipmentId, orderItemId],
    );
    return rows.map((row) => row.serial_number);
  }

  /**
   * Packed totals per order item for one shipment across live packages
   * (OPEN / SEALED / REPACK_REQUIRED - CANCELLED and SHIPPED excluded),
   * computed on the caller's connection.
   */
  async packedTotalsByShipmentTx(
    manager: EntityManager,
    shipmentId: string,
  ): Promise<Map<string, bigint>> {
    const rows = await manager.query<Array<{ order_item_id: string; packed: string }>>(
      `SELECT pi.order_item_id, SUM(pi.quantity)::text AS packed
         FROM package_items pi
         JOIN packages p ON p.id = pi.package_id
        WHERE p.shipment_id = $1::uuid
          AND p.status IN ('OPEN', 'SEALED', 'REPACK_REQUIRED')
        GROUP BY pi.order_item_id`,
      [shipmentId],
    );
    return new Map(rows.map((row) => [row.order_item_id, parseQty(row.packed)]));
  }

  /**
   * Unpacks an order item from every live (non-shipped) package of every
   * shipment: item rows and packed serials are removed. Returns the affected
   * package ids (pre-removal status implied: the caller decides which of them
   * were SEALED and must become REPACK_REQUIRED) plus which packages became
   * empty. Interception-only (task §43/§75).
   */
  async removeItemsForOrderItemTx(
    manager: EntityManager,
    orderItemId: string,
  ): Promise<{ affectedPackageIds: string[]; emptiedPackageIds: string[] }> {
    const affected = await manager.query<Array<{ id: string }>>(
      `SELECT DISTINCT p.id
         FROM packages p
         JOIN package_items pi ON pi.package_id = p.id
        WHERE pi.order_item_id = $1::uuid
          AND p.status <> 'CANCELLED' AND p.status <> 'SHIPPED'`,
      [orderItemId],
    );
    if (affected.length === 0) {
      return { affectedPackageIds: [], emptiedPackageIds: [] };
    }
    const packageIds = affected.map((row) => row.id);
    await manager.query(`DELETE FROM package_items WHERE order_item_id = $1::uuid`, [orderItemId]);
    const emptied = await manager.query<Array<{ id: string }>>(
      `SELECT p.id
         FROM packages p
        WHERE p.id = ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM package_items pi WHERE pi.package_id = p.id)`,
      [packageIds],
    );
    return { affectedPackageIds: packageIds, emptiedPackageIds: emptied.map((row) => row.id) };
  }

  /** Live packages of a shipment that are not SEALED (read on pool). */
  async countUnsealedPackages(shipmentId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt FROM packages
        WHERE shipment_id = $1::uuid AND status IN ('OPEN', 'REPACK_REQUIRED')`,
      [shipmentId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** Serialized unit count of one package item, in milli-units. */
  async countSerialsOfItemTx(manager: EntityManager, packageItemId: string): Promise<bigint> {
    const rows = await manager.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*)::int AS cnt FROM package_item_serials WHERE package_item_id = $1::uuid`,
      [packageItemId],
    );
    return BigInt(rows[0]?.cnt ?? 0) * 1000n;
  }

  /** Formatting helper for callers building guard details. */
  fmt(milli: bigint): string {
    return formatQty(milli);
  }
}
