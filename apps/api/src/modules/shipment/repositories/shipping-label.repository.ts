import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { ShippingLabelEntity } from '../entities/shipping-label.entity';
import { ShippingLabelSource, ShippingLabelType } from '../enums/shipment.constants';
import { ShippingLabelPurgeCandidate, ShippingLabelPurgeCursor } from '../shipping-label.types';

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
      purgedAt: null,
    });
    return repository.save(entity);
  }

  async listByShipmentId(shipmentId: string): Promise<ShippingLabelEntity[]> {
    return this.dataSource
      .getRepository(ShippingLabelEntity)
      .find({ where: { shipmentId, purgedAt: IsNull() }, order: { createdAt: 'DESC' } });
  }

  /** Order-scoped labels (platform 面单 fetched before a Shipment exists). */
  async listByOrderId(orderId: string): Promise<ShippingLabelEntity[]> {
    return this.dataSource
      .getRepository(ShippingLabelEntity)
      .find({ where: { orderId, purgedAt: IsNull() }, order: { createdAt: 'DESC' } });
  }

  /** Latest order-scoped label of a given source, for reuse instead of re-fetch. */
  async findLatestByOrderAndSource(
    orderId: string,
    source: ShippingLabelSource,
  ): Promise<ShippingLabelEntity | null> {
    return this.dataSource.getRepository(ShippingLabelEntity).findOne({
      where: { orderId, source, purgedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  /** Actively readable label row; purged rows are invisible to every reader. */
  async findById(id: string): Promise<ShippingLabelEntity | null> {
    return this.dataSource
      .getRepository(ShippingLabelEntity)
      .findOne({ where: { id, purgedAt: IsNull() } });
  }

  /**
   * Labels whose owning order reached a terminal state, oldest first.
   *
   * Terminal = CANCELLED, or SHIPPED + platform DELIVERED (the list's
   * COMPLETED stage). A platform-delivered order that has not converged to
   * ERP SHIPPED is a DIVERGENT order and must keep its label: the operator
   * may still need it.
   *
   * `after` is a keyset cursor so one sweep run can walk several batches
   * without re-selecting rows that failed to purge in this run.
   */
  async findPurgeCandidates(options: {
    limit: number;
    graceMinutes: number;
    after?: ShippingLabelPurgeCursor | null;
  }): Promise<ShippingLabelPurgeCandidate[]> {
    const query = this.dataSource
      .createQueryBuilder()
      .select('l.id', 'id')
      .addSelect('l.object_key', 'objectKey')
      .addSelect('l.file_name', 'fileName')
      .addSelect('l.created_at', 'createdAt')
      .from('shipping_labels', 'l')
      .leftJoin('shipments', 's', 's.id = l.shipment_id')
      .innerJoin('orders', 'o', 'o.id = COALESCE(l.order_id, s.order_id)')
      .where('l.purged_at IS NULL')
      .andWhere(
        `(o.erp_status = 'CANCELLED'
          OR (o.erp_status = 'SHIPPED' AND o.platform_stage = 'DELIVERED'))`,
      )
      .andWhere(
        `COALESCE(o.platform_stage_changed_at, o.updated_at) <= now() - make_interval(mins => :graceMinutes)`,
        { graceMinutes: options.graceMinutes },
      )
      .orderBy('l.created_at', 'ASC')
      .addOrderBy('l.id', 'ASC')
      .limit(options.limit);

    if (options.after !== undefined && options.after !== null) {
      query.andWhere('(l.created_at, l.id) > (:afterCreatedAt, :afterId)', {
        afterCreatedAt: options.after.createdAt,
        afterId: options.after.id,
      });
    }

    const rows = await query.getRawMany<{
      id: string;
      objectKey: string;
      fileName: string;
      createdAt: Date;
    }>();
    return rows;
  }

  /**
   * Marks a label purged. Conditional on `purged_at IS NULL`, so a concurrent
   * sweep cannot double-log the same row. Returns false when another run won.
   */
  async markPurged(id: string, purgedAt: Date): Promise<boolean> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(ShippingLabelEntity)
      .set({ purgedAt })
      .where('id = :id AND purged_at IS NULL', { id })
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
