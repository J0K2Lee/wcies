import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { TransferOrderEntity } from '../entities/transfer-order.entity';
import { TransferOrderLineEntity } from '../entities/transfer-order-line.entity';

export interface TransferListFilters {
  keyword?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  status?: string;
}

export interface TransferListRow {
  transfer: TransferOrderEntity;
  fromWarehouseName: string | null;
  toWarehouseName: string | null;
  linesCount: number;
}

/** Data access for transfer orders. */
@Injectable()
export class TransferOrderRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insertWithLines(
    manager: EntityManager,
    header: Partial<TransferOrderEntity>,
    lines: Array<{
      skuId: string;
      quantity: string;
      fromBinId: string | null;
      toBinId: string | null;
      remark?: string | null;
    }>,
  ): Promise<TransferOrderEntity> {
    const repository = manager.getRepository(TransferOrderEntity);
    const created = await repository.save(repository.create(header));
    const lineRepository = manager.getRepository(TransferOrderLineEntity);
    if (lines.length > 0) {
      await lineRepository.insert(lines.map((line) => ({ ...line, transferId: created.id })));
    }
    return created;
  }

  async findById(id: string): Promise<TransferOrderEntity | null> {
    return this.dataSource.getRepository(TransferOrderEntity).findOneBy({ id });
  }

  async listLines(transferId: string): Promise<TransferOrderLineEntity[]> {
    return this.dataSource
      .getRepository(TransferOrderLineEntity)
      .createQueryBuilder('l')
      .where('l.transfer_id = :transferId', { transferId })
      .orderBy('l.created_at', 'ASC')
      .getMany();
  }

  /** Lines enriched with sku code/name and bin codes for display. */
  async listLinesWithRefs(transferId: string): Promise<
    Array<{
      line: TransferOrderLineEntity;
      skuCode: string;
      skuName: string;
      fromBinCode: string | null;
      toBinCode: string | null;
    }>
  > {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT l.*, s.sku_code AS sku_code, s.name_zh AS sku_name,
              bf.bin_code AS from_bin_code, bt.bin_code AS to_bin_code
       FROM transfer_order_lines l
       LEFT JOIN skus s ON s.id = l.sku_id
       LEFT JOIN warehouse_bins bf ON bf.id = l.from_bin_id
       LEFT JOIN warehouse_bins bt ON bt.id = l.to_bin_id
       WHERE l.transfer_id = $1::uuid
       ORDER BY l.created_at ASC`,
      [transferId],
    );
    const repository = this.dataSource.getRepository(TransferOrderLineEntity);
    return rows.map((row) => ({
      line: repository.create({
        id: String(row['id']),
        transferId: String(row['transfer_id']),
        skuId: String(row['sku_id']),
        quantity: String(row['quantity']),
        fromBinId: (row['from_bin_id'] as string | null) ?? null,
        toBinId: (row['to_bin_id'] as string | null) ?? null,
        outEventNo: (row['out_event_no'] as string | null) ?? null,
        inEventNo: (row['in_event_no'] as string | null) ?? null,
        remark: (row['remark'] as string | null) ?? null,
        createdAt: new Date(String(row['created_at'])),
      }),
      skuCode: (row['sku_code'] as string | null) ?? '',
      skuName: (row['sku_name'] as string | null) ?? '',
      fromBinCode: (row['from_bin_code'] as string | null) ?? null,
      toBinCode: (row['to_bin_code'] as string | null) ?? null,
    }));
  }

  async listLinesInTx(
    manager: EntityManager,
    transferId: string,
  ): Promise<TransferOrderLineEntity[]> {
    return manager
      .getRepository(TransferOrderLineEntity)
      .createQueryBuilder('l')
      .where('l.transfer_id = :transferId', { transferId })
      .orderBy('l.created_at', 'ASC')
      .getMany();
  }

  async markLineLegs(
    manager: EntityManager,
    lineId: string,
    patch: { outEventNo?: string; inEventNo?: string },
  ): Promise<void> {
    await manager.getRepository(TransferOrderLineEntity).update({ id: lineId }, patch);
  }

  async updateStatus(
    manager: EntityManager,
    id: string,
    status: TransferOrderEntity['status'],
  ): Promise<void> {
    await manager
      .getRepository(TransferOrderEntity)
      .update({ id }, { status, updatedAt: new Date() });
  }

  async list(
    filters: TransferListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: TransferListRow[]; total: number }> {
    const qb = this.dataSource
      .getRepository(TransferOrderEntity)
      .createQueryBuilder('t')
      .leftJoin('warehouses', 'wfrom', 'wfrom.id = t.from_warehouse_id')
      .leftJoin('warehouses', 'wto', 'wto.id = t.to_warehouse_id')
      .addSelect('wfrom.name', 'from_name')
      .addSelect('wto.name', 'to_name')
      .addSelect(
        `(SELECT COUNT(*) FROM transfer_order_lines l WHERE l.transfer_id = t.id)`,
        'lines_count',
      );
    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere('t.transfer_no ILIKE :kw', { kw: `%${filters.keyword}%` });
    }
    if (filters.fromWarehouseId !== undefined && filters.fromWarehouseId !== '') {
      qb.andWhere('t.from_warehouse_id = :fromWarehouseId', {
        fromWarehouseId: filters.fromWarehouseId,
      });
    }
    if (filters.toWarehouseId !== undefined && filters.toWarehouseId !== '') {
      qb.andWhere('t.to_warehouse_id = :toWarehouseId', {
        toWarehouseId: filters.toWarehouseId,
      });
    }
    if (filters.status !== undefined && filters.status !== '') {
      qb.andWhere('t.status = :status', { status: filters.status });
    }
    qb.orderBy('t.created_at', 'DESC');
    const [raw, total] = await Promise.all([
      qb.limit(limit).offset(offset).getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawRows = raw.raw as Array<Record<string, unknown>>;
    const rows: TransferListRow[] = raw.entities.map((transfer, index) => ({
      transfer,
      fromWarehouseName: (rawRows[index]?.from_name as string | null) ?? null,
      toWarehouseName: (rawRows[index]?.to_name as string | null) ?? null,
      linesCount: Number(rawRows[index]?.lines_count ?? 0),
    }));
    return { rows, total };
  }
}
