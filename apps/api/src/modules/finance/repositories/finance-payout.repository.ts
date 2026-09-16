import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FinancePayoutEntity } from '../entities/finance-payout.entity';

export interface FinancePayoutFilters {
  keyword?: string;
  storeId?: string;
  status?: string;
}

export interface FinancePayoutListRow {
  payout: FinancePayoutEntity;
  storeName: string | null;
}

/** Data access for platform payout batches (finance.md §4). */
@Injectable()
export class FinancePayoutRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insert(
    manager: EntityManager,
    data: Partial<FinancePayoutEntity>,
  ): Promise<FinancePayoutEntity> {
    const repository = manager.getRepository(FinancePayoutEntity);
    return repository.save(repository.create(data));
  }

  async findById(id: string): Promise<FinancePayoutEntity | null> {
    return this.dataSource.getRepository(FinancePayoutEntity).findOneBy({ id });
  }

  async updateStatus(
    manager: EntityManager,
    id: string,
    status: FinancePayoutEntity['status'],
  ): Promise<void> {
    await manager
      .getRepository(FinancePayoutEntity)
      .update({ id }, { status, updatedAt: new Date() });
  }

  async list(
    filters: FinancePayoutFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: FinancePayoutListRow[]; total: number }> {
    const qb = this.dataSource
      .getRepository(FinancePayoutEntity)
      .createQueryBuilder('p')
      .leftJoin('stores', 's', 's.id = p.store_id')
      .addSelect('s.name', 'store_name');
    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere('p.payout_no ILIKE :kw', { kw: `%${filters.keyword}%` });
    }
    if (filters.storeId !== undefined && filters.storeId !== '') {
      qb.andWhere('p.store_id = :storeId', { storeId: filters.storeId });
    }
    if (filters.status !== undefined && filters.status !== '') {
      qb.andWhere('p.status = :status', { status: filters.status });
    }
    qb.orderBy('p.created_at', 'DESC');
    const [raw, total] = await Promise.all([
      qb.limit(limit).offset(offset).getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawRows = raw.raw as Array<Record<string, unknown>>;
    const rows: FinancePayoutListRow[] = raw.entities.map((payout, index) => ({
      payout,
      storeName: (rawRows[index]?.store_name as string | null) ?? null,
    }));
    return { rows, total };
  }
}
