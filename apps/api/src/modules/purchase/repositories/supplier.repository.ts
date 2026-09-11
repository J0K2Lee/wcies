import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupplierEntity } from '../entities/supplier.entity';

export interface SupplierListFilters {
  keyword?: string;
  status?: string;
}

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class SupplierRepository {
  constructor(
    @InjectRepository(SupplierEntity)
    private readonly supplierRepository: Repository<SupplierEntity>,
  ) {}

  async list(
    filters: SupplierListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: SupplierEntity[]; total: number }> {
    const qb = this.supplierRepository.createQueryBuilder('s');
    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere('(s.code ILIKE :kw OR s.name ILIKE :kw)', { kw: `%${filters.keyword}%` });
    }
    if (filters.status !== undefined) {
      qb.andWhere('s.status = :status', { status: filters.status });
    }
    qb.orderBy('s.createdAt', 'DESC').skip(offset).take(limit);
    const [rows, total] = await Promise.all([qb.getMany(), qb.getCount()]);
    return { rows, total };
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
   * Reference census for the zero-reference delete guard (decision 0003).
   * Sprint 7 adds the referencing tables incrementally: purchase_orders in
   * T3, purchase_receipts in T4 - each task extends this list with its table.
   */
  async countReferences(_id: string): Promise<Array<{ table: string; count: number }>> {
    return [];
  }
}
