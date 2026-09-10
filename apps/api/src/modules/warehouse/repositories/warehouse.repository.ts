import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, QueryDeepPartialEntity, Repository } from 'typeorm';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { WarehouseBinEntity } from '../entities/warehouse-bin.entity';
import { StoreWarehouseBindingEntity } from '../entities/store-warehouse-binding.entity';

export interface WarehouseListFilters {
  keyword?: string;
  warehouseType?: string;
  status?: string;
}

export interface WarehouseRowWithCounts {
  warehouse: WarehouseEntity;
  binCount: number;
  boundStoreCount: number;
}

export interface BindingListFilters {
  storeId?: string;
  warehouseId?: string;
  status?: string;
}

export interface BindingRowWithRefs {
  binding: StoreWarehouseBindingEntity;
  storeName: string;
  storeCode: string;
  platformCode: string;
  warehouseCode: string;
  warehouseName: string;
}

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class WarehouseRepository {
  constructor(
    @InjectRepository(WarehouseEntity)
    private readonly warehouseRepository: Repository<WarehouseEntity>,
    @InjectRepository(WarehouseBinEntity)
    private readonly binRepository: Repository<WarehouseBinEntity>,
    @InjectRepository(StoreWarehouseBindingEntity)
    private readonly bindingRepository: Repository<StoreWarehouseBindingEntity>,
  ) {}

  // ---- Warehouse ----

  async listWithCounts(
    filters: WarehouseListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: WarehouseRowWithCounts[]; total: number }> {
    const qb = this.warehouseRepository
      .createQueryBuilder('wh')
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(bin.id)')
            .from('warehouse_bins', 'bin')
            .where('bin.warehouse_id = wh.id'),
        'bin_count',
      )
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(DISTINCT binding.store_id)')
            .from('store_warehouse_bindings', 'binding')
            .where('binding.warehouse_id = wh.id')
            .andWhere("binding.status = 'ACTIVE'"),
        'bound_store_count',
      );

    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere('(wh.warehouse_code ILIKE :kw OR wh.name ILIKE :kw OR wh.city ILIKE :kw)', {
        kw: `%${filters.keyword}%`,
      });
    }
    if (filters.warehouseType !== undefined) {
      qb.andWhere('wh.warehouse_type = :warehouseType', { warehouseType: filters.warehouseType });
    }
    if (filters.status !== undefined) {
      qb.andWhere('wh.status = :status', { status: filters.status });
    }

    qb.orderBy('wh.createdAt', 'DESC').skip(offset).take(limit);

    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;

    const rows: WarehouseRowWithCounts[] = rawList.map((raw, index) => ({
      warehouse: entities[index] as WarehouseEntity,
      binCount: Number(raw['bin_count'] ?? 0),
      boundStoreCount: Number(raw['bound_store_count'] ?? 0),
    }));
    return { rows, total };
  }

  async findWarehouseById(id: string): Promise<WarehouseEntity | null> {
    return this.warehouseRepository.findOneBy({ id });
  }

  async findWarehouseByCode(code: string): Promise<WarehouseEntity | null> {
    return this.warehouseRepository.findOneBy({ warehouseCode: code });
  }

  async insertWarehouse(warehouse: Partial<WarehouseEntity>): Promise<WarehouseEntity> {
    const created = this.warehouseRepository.create(
      warehouse as unknown as DeepPartial<WarehouseEntity>,
    );
    return this.warehouseRepository.save(created);
  }

  async updateWarehouse(id: string, patch: Partial<WarehouseEntity>): Promise<void> {
    await this.warehouseRepository.update({ id }, patch);
  }

  /** Tables whose warehouse_id rows block a hard delete (decision 0003). */
  async countWarehouseReferences(id: string): Promise<Array<{ table: string; count: number }>> {
    const rows = await this.warehouseRepository.query<
      Array<Record<string, string | number>>
    >(
      `SELECT
        (SELECT COUNT(*) FROM warehouse_bins WHERE warehouse_id = $1) AS warehouse_bins,
        (SELECT COUNT(*) FROM store_warehouse_bindings WHERE warehouse_id = $1) AS store_warehouse_bindings,
        (SELECT COUNT(*) FROM inventory_balances WHERE warehouse_id = $1) AS inventory_balances,
        (SELECT COUNT(*) FROM inventory_safety_stocks WHERE warehouse_id = $1) AS inventory_safety_stocks,
        (SELECT COUNT(*) FROM inventory_reservations WHERE warehouse_id = $1) AS inventory_reservations,
        (SELECT COUNT(*) FROM inventory_serials WHERE warehouse_id = $1) AS inventory_serials,
        (SELECT COUNT(*) FROM inventory_transactions WHERE warehouse_id = $1) AS inventory_transactions,
        (SELECT COUNT(*) FROM order_items WHERE warehouse_id = $1) AS order_items,
        (SELECT COUNT(*) FROM order_interceptions WHERE warehouse_id = $1) AS order_interceptions,
        (SELECT COUNT(*) FROM picking_tasks WHERE warehouse_id = $1) AS picking_tasks,
        (SELECT COUNT(*) FROM shipments WHERE warehouse_id = $1) AS shipments`,
      [id],
    );
    return Object.entries(rows[0] ?? {}).map(([table, count]) => ({
      table,
      count: Number(count),
    }));
  }

  async deleteWarehouse(id: string): Promise<void> {
    await this.warehouseRepository.delete({ id });
  }

  // ---- Bins ----

  async listBins(
    warehouseId: string,
    filters: { keyword?: string; status?: string },
    limit: number,
    offset: number,
  ): Promise<{ rows: WarehouseBinEntity[]; total: number }> {
    const qb = this.binRepository
      .createQueryBuilder('bin')
      .where('bin.warehouse_id = :warehouseId', { warehouseId });
    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere(
        '(bin.bin_code ILIKE :kw OR bin.barcode ILIKE :kw OR bin.zone ILIKE :kw OR bin.rack ILIKE :kw)',
        { kw: `%${filters.keyword}%` },
      );
    }
    if (filters.status !== undefined) {
      qb.andWhere('bin.status = :status', { status: filters.status });
    }
    qb.orderBy('bin.binCode', 'ASC').skip(offset).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  async findBinById(id: string): Promise<WarehouseBinEntity | null> {
    return this.binRepository.findOneBy({ id });
  }

  async findBinByCode(warehouseId: string, binCode: string): Promise<WarehouseBinEntity | null> {
    return this.binRepository.findOneBy({ warehouseId, binCode });
  }

  async countBins(warehouseId: string): Promise<number> {
    return this.binRepository.count({ where: { warehouseId } });
  }

  async findExistingBinCodes(
    warehouseId: string,
    binCodes: string[],
  ): Promise<WarehouseBinEntity[]> {
    if (binCodes.length === 0) {
      return [];
    }
    return this.binRepository
      .createQueryBuilder('bin')
      .where('bin.warehouse_id = :warehouseId', { warehouseId })
      .andWhere('bin.bin_code IN (:...binCodes)', { binCodes })
      .getMany();
  }

  async insertBins(bins: Array<Partial<WarehouseBinEntity>>): Promise<void> {
    if (bins.length === 0) {
      return;
    }
    await this.binRepository.insert(bins);
  }

  async insertBin(bin: Partial<WarehouseBinEntity>): Promise<WarehouseBinEntity> {
    const created = this.binRepository.create(bin as unknown as DeepPartial<WarehouseBinEntity>);
    return this.binRepository.save(created);
  }

  async updateBin(id: string, patch: Partial<WarehouseBinEntity>): Promise<void> {
    await this.binRepository.update({ id }, patch);
  }

  /** Tables whose bin_id rows block a hard delete (decision 0003). */
  async countBinReferences(id: string): Promise<Array<{ table: string; count: number }>> {
    const rows = await this.binRepository.query<Array<Record<string, string | number>>>(
      `SELECT
        (SELECT COUNT(*) FROM inventory_balances WHERE bin_id = $1) AS inventory_balances,
        (SELECT COUNT(*) FROM inventory_reservation_lines WHERE bin_id = $1) AS inventory_reservation_lines,
        (SELECT COUNT(*) FROM inventory_serials WHERE bin_id = $1) AS inventory_serials,
        (SELECT COUNT(*) FROM inventory_transactions WHERE bin_id = $1) AS inventory_transactions`,
      [id],
    );
    return Object.entries(rows[0] ?? {}).map(([table, count]) => ({
      table,
      count: Number(count),
    }));
  }

  async deleteBin(id: string): Promise<void> {
    await this.binRepository.delete({ id });
  }

  // ---- Bindings ----

  async listBindingsWithRefs(
    filters: BindingListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: BindingRowWithRefs[]; total: number }> {
    const qb = this.bindingRepository
      .createQueryBuilder('binding')
      .innerJoin('stores', 'store', 'store.id = binding.store_id')
      .innerJoin('platforms', 'platform', 'platform.id = store.platform_id')
      .innerJoin('warehouses', 'wh', 'wh.id = binding.warehouse_id')
      .addSelect('store.name', 'store_name')
      .addSelect('store.store_code', 'store_code')
      .addSelect('platform.code', 'platform_code')
      .addSelect('wh.warehouse_code', 'warehouse_code')
      .addSelect('wh.name', 'warehouse_name');

    if (filters.storeId !== undefined) {
      qb.andWhere('binding.store_id = :storeId', { storeId: filters.storeId });
    }
    if (filters.warehouseId !== undefined) {
      qb.andWhere('binding.warehouse_id = :warehouseId', { warehouseId: filters.warehouseId });
    }
    if (filters.status !== undefined) {
      qb.andWhere('binding.status = :status', { status: filters.status });
    }

    qb.orderBy('binding.createdAt', 'DESC').skip(offset).take(limit);

    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;

    const rows: BindingRowWithRefs[] = rawList.map((raw, index) => ({
      binding: entities[index] as StoreWarehouseBindingEntity,
      storeName: String(raw['store_name'] as string),
      storeCode: String(raw['store_code'] as string),
      platformCode: String(raw['platform_code'] as string),
      warehouseCode: String(raw['warehouse_code'] as string),
      warehouseName: String(raw['warehouse_name'] as string),
    }));
    return { rows, total };
  }

  async findBindingById(id: string): Promise<StoreWarehouseBindingEntity | null> {
    return this.bindingRepository.findOneBy({ id });
  }

  async findBinding(
    storeId: string,
    warehouseId: string,
    fulfillmentMode: string,
  ): Promise<StoreWarehouseBindingEntity | null> {
    return this.bindingRepository.findOneBy({ storeId, warehouseId, fulfillmentMode });
  }

  async insertBinding(
    binding: Partial<StoreWarehouseBindingEntity>,
  ): Promise<StoreWarehouseBindingEntity> {
    const created = this.bindingRepository.create(
      binding as unknown as DeepPartial<StoreWarehouseBindingEntity>,
    );
    return this.bindingRepository.save(created);
  }

  async updateBinding(id: string, patch: Partial<StoreWarehouseBindingEntity>): Promise<void> {
    await this.bindingRepository.update(
      { id },
      patch as unknown as QueryDeepPartialEntity<StoreWarehouseBindingEntity>,
    );
  }

  async deleteBinding(id: string): Promise<void> {
    await this.bindingRepository.delete({ id });
  }
}
