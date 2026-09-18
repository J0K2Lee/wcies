import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ShippingLabelEntity } from '../entities/shipping-label.entity';
import { ShippingLabelSource, ShippingLabelType } from '../enums/shipment.constants';

/** Data access for shipping-label metadata rows. */
@Injectable()
export class ShippingLabelRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(
    manager: EntityManager,
    row: {
      /** Exactly one of shipmentId / orderId is set (DB CHECK). */
      shipmentId?: string | null;
      orderId?: string | null;
      packageId?: string | null;
      labelType: ShippingLabelType;
      objectKey: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      source: ShippingLabelSource;
      externalLabelId?: string | null;
      uploadedBy?: string | null;
    },
  ): Promise<ShippingLabelEntity> {
    const repository = manager.getRepository(ShippingLabelEntity);
    const entity = repository.create({
      ...row,
      shipmentId: row.shipmentId ?? null,
      orderId: row.orderId ?? null,
      packageId: row.packageId ?? null,
      externalLabelId: row.externalLabelId ?? null,
    });
    return repository.save(entity);
  }

  async listByShipmentId(shipmentId: string): Promise<ShippingLabelEntity[]> {
    return this.dataSource
      .getRepository(ShippingLabelEntity)
      .find({ where: { shipmentId }, order: { createdAt: 'DESC' } });
  }

  /** Order-scoped labels (platform 面单 fetched before a Shipment exists). */
  async listByOrderId(orderId: string): Promise<ShippingLabelEntity[]> {
    return this.dataSource
      .getRepository(ShippingLabelEntity)
      .find({ where: { orderId }, order: { createdAt: 'DESC' } });
  }

  /** Latest order-scoped label of a given source, for reuse instead of re-fetch. */
  async findLatestByOrderAndSource(
    orderId: string,
    source: ShippingLabelSource,
  ): Promise<ShippingLabelEntity | null> {
    return this.dataSource
      .getRepository(ShippingLabelEntity)
      .findOne({ where: { orderId, source }, order: { createdAt: 'DESC' } });
  }
}
