import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, QueryDeepPartialEntity, Repository } from 'typeorm';
import { StoreEntity } from '../entities/store.entity';

export interface StoreListFilters {
  platformId?: string;
  status?: string;
  keyword?: string;
}

export interface StoreRowWithCounts {
  store: StoreEntity;
  platformCode: string;
  platformName: string;
  credentialConfigured: boolean;
  bindingCount: number;
}

/**
 * Data access only - no business rules here (AGENTS.md §8).
 *
 * List counts (credential status, binding count) are computed with subselects
 * in ONE query to avoid per-row N+1 (Sprint 1 task §93).
 */
@Injectable()
export class StoreRepository {
  constructor(
    @InjectRepository(StoreEntity)
    private readonly repository: Repository<StoreEntity>,
  ) {}

  async listWithCounts(
    filters: StoreListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: StoreRowWithCounts[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('store')
      .innerJoin('platforms', 'platform', 'platform.id = store.platform_id')
      .addSelect('platform.code', 'platform_code')
      .addSelect('platform.name', 'platform_name')
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(cred.id)')
            .from('platform_credentials', 'cred')
            .where('cred.store_id = store.id')
            .andWhere('cred.status = :credActive', { credActive: 'ACTIVE' }),
        'credential_configured',
      )
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(binding.id)')
            .from('store_warehouse_bindings', 'binding')
            .where('binding.store_id = store.id')
            .andWhere('binding.status = :bindingActive', { bindingActive: 'ACTIVE' }),
        'binding_count',
      );

    if (filters.platformId !== undefined) {
      qb.andWhere('store.platform_id = :platformId', { platformId: filters.platformId });
    }
    if (filters.status !== undefined) {
      qb.andWhere('store.status = :status', { status: filters.status });
    }
    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere('(store.store_code ILIKE :kw OR store.name ILIKE :kw)', {
        kw: `%${filters.keyword}%`,
      });
    }

    qb.orderBy('store.created_at', 'DESC').skip(offset).take(limit);

    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;

    const rows: StoreRowWithCounts[] = rawList.map((raw, index) => ({
      store: entities[index] as StoreEntity,
      platformCode: String(raw['platform_code'] as string),
      platformName: String(raw['platform_name'] as string),
      credentialConfigured: Number(raw['credential_configured'] ?? 0) > 0,
      bindingCount: Number(raw['binding_count'] ?? 0),
    }));
    return { rows, total };
  }

  async findById(id: string): Promise<StoreEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async findByPlatformAndCode(platformId: string, storeCode: string): Promise<StoreEntity | null> {
    return this.repository.findOneBy({ platformId, storeCode });
  }

  async insert(store: Partial<StoreEntity>): Promise<StoreEntity> {
    // jsonb columns (settings) don't fit QueryDeepPartialEntity's shape; the
    // repository boundary is the single controlled cast point.
    const created = this.repository.create(store as unknown as DeepPartial<StoreEntity>);
    return this.repository.save(created);
  }

  async update(id: string, patch: Partial<StoreEntity>): Promise<void> {
    await this.repository.update({ id }, patch as unknown as QueryDeepPartialEntity<StoreEntity>);
  }
}
