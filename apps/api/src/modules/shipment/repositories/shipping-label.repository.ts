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
      shipmentId: string;
      packageId?: string | null;
      labelType: ShippingLabelType;
      objectKey: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      source: ShippingLabelSource;
      uploadedBy?: string | null;
    },
  ): Promise<ShippingLabelEntity> {
    const repository = manager.getRepository(ShippingLabelEntity);
    const entity = repository.create({ ...row, packageId: row.packageId ?? null });
    return repository.save(entity);
  }

  async listByShipmentId(shipmentId: string): Promise<ShippingLabelEntity[]> {
    return this.dataSource
      .getRepository(ShippingLabelEntity)
      .find({ where: { shipmentId }, order: { createdAt: 'DESC' } });
  }
}
