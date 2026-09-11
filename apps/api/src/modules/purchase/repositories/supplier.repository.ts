import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SupplierEntity } from '../entities/supplier.entity';

export interface SupplierListFilters {
  keyword?: string;
  status?: string;
}

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class SupplierRepository {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SupplierEntity)
    private readonly supplierRepository: Repository<SupplierEntity>,
  ) {}

  async list(
    filters: SupplierListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: Array<{ supplier: SupplierEntity; referenceCount: number }>; total: number }> {
    const qb = this.supplierRepository
      .createQueryBuilder('s')
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(*)')
            .from('purchase_orders', 'po')
            .where('po.supplier_id = s.id AND po.status <> :cancelled', { cancelled: 'CANCELLED' }),
        'reference_count',
      );
    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere('(s.code ILIKE :kw OR s.name ILIKE :kw)', { kw: `%${filters.keyword}%` });
    }
    if (filters.status !== undefined) {
      qb.andWhere('s.status = :status', { status: filters.status });
    }
    qb.orderBy('s.createdAt', 'DESC').skip(offset).take(limit);
    const [rawRows, total] = await Promise.all([qb.getRawAndEntities(), qb.getCount()]);
    const rawList = rawRows.raw as Array<Record<string, unknown>>;
    return {
      rows: rawRows.entities.map((supplier, index) => ({
        supplier,
        referenceCount: Number(rawList[index]?.['reference_count'] ?? 0),
      })),
      total,
    };
  }

  async findById(id: string): Promise<SupplierEntity | null> {
    return this.supplierRepository.findOneBy({ id });
  }

  async findByCode(code: string): Promise<SupplierEntity | null> {
    return this.supplierRepository.findOneBy({ code });
  }

  async insert(supplier: {
    code: string;
    name: string;
    contactName: string | null;
    contactPhone: string | null;
    status: string;
    remark: string | null;
  }): Promise<SupplierEntity> {
    const created = this.supplierRepository.create(supplier);
    return this.supplierRepository.save(created);
  }

  async update(id: string, patch: Partial<SupplierEntity>): Promise<void> {
    await this.supplierRepository.update({ id }, { ...patch, updatedAt: new Date() });
  }

  async delete(id: string): Promise<void> {
    await this.supplierRepository.delete({ id });
  }

  /**
   * Reference census for the zero-reference delete guard (decision 0003):
   * purchase orders (T3) and purchase receipts (T4) - including cancelled
   * rows, which remain audit history referencing the supplier.
   */
  async countReferences(id: string): Promise<Array<{ table: string; count: number }>> {
    const result = await this.dataSource.query<Array<{ table: string; count: string }>>(
      `SELECT 'purchase_orders' AS table, COUNT(*)::text AS count FROM purchase_orders WHERE supplier_id = $1
       UNION ALL
       SELECT 'purchase_receipts', COUNT(*)::text FROM purchase_receipts WHERE supplier_id = $1`,
      [id],
    );
    return result.map((row) => ({ table: row.table, count: Number(row.count) }));
  }
}
