import { describe, expect, it, vi } from 'vitest';
import { WarehousePlatformBindingService } from './warehouse-platform-binding.service';
import { WarehouseRepository } from '../repositories/warehouse.repository';
import { StoreService } from '../../store/services/store.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { WarehouseEntity } from '../entities/warehouse.entity';
import { StoreEntity } from '../../store/entities/store.entity';

const operator = { userId: null, username: 'test' };

function makeWarehouse(type: string): WarehouseEntity {
  return {
    id: 'wh-1',
    warehouseCode: 'SZ01',
    name: '深圳仓',
    warehouseType: type,
    countryCode: null,
    province: null,
    city: null,
    address: null,
    contactName: null,
    contactPhone: null,
    status: 'ACTIVE',
    remark: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeStore(platformId: string): StoreEntity {
  return {
    id: 'store-1',
    platformId,
    storeCode: 'OZON-A',
    name: 'OZON A',
    sellerId: null,
    defaultCurrency: null,
    status: 'ACTIVE',
    settings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildService(opts: {
  platformCode: string;
  warehouseType: string;
  existingPlatformBinding?: unknown;
  existingBindingCount?: number;
}) {
  const repository = {
    findWarehouseById: vi.fn().mockResolvedValue(makeWarehouse(opts.warehouseType)),
    findPlatformBinding: vi.fn().mockResolvedValue(opts.existingPlatformBinding ?? null),
    countPlatformBindingsByWarehouse: vi.fn().mockResolvedValue(opts.existingBindingCount ?? 0),
    insertPlatformBinding: vi.fn().mockImplementation((binding: Record<string, unknown>) =>
      Promise.resolve({
        id: 'binding-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...binding,
      }),
    ),
  } as unknown as WarehouseRepository;
  const storeService = {
    getEntityWithPlatform: vi.fn().mockResolvedValue({
      store: makeStore('platform-ozon'),
      platformCode: opts.platformCode,
    }),
  } as unknown as StoreService;
  const operationLog = {
    record: vi.fn().mockResolvedValue(undefined),
  } as unknown as OperationLogService;
  return {
    service: new WarehousePlatformBindingService(repository, storeService, operationLog),
    repository,
  };
}

const dto = {
  storeId: 'store-1',
  platformWarehouseId: '1020005000770362',
  fulfillmentMode: 'OZON_FBO' as const,
  remarkName: '俄东主仓',
};

describe('WarehousePlatformBindingService validation (用户指示 2026-09-17)', () => {
  it('binds an OZON_FBO platform warehouse to a PLATFORM (托管仓) warehouse', async () => {
    const { service, repository } = buildService({
      platformCode: 'OZON',
      warehouseType: 'PLATFORM',
    });
    const result = await service.create('wh-1', dto, operator);
    expect(result.platformWarehouseId).toBe('1020005000770362');
    expect(result.remarkName).toBe('俄东主仓');
    expect(repository.insertPlatformBinding).toHaveBeenCalled();
  });

  it('binds OZON_RFBS / OZON_FBS platform warehouses to SELF (自管仓) warehouses', async () => {
    const { service } = buildService({ platformCode: 'OZON', warehouseType: 'SELF' });
    await expect(
      service.create('wh-1', { ...dto, fulfillmentMode: 'OZON_RFBS' as const }, operator),
    ).resolves.toMatchObject({ fulfillmentMode: 'OZON_RFBS' as const });
    await expect(
      service.create('wh-1', { ...dto, fulfillmentMode: 'OZON_FBS' as const }, operator),
    ).resolves.toMatchObject({ fulfillmentMode: 'OZON_FBS' as const });
  });

  it('binds OZON_FBP only to SEMI_MANAGED (半托管) warehouses', async () => {
    const semi = buildService({ platformCode: 'OZON', warehouseType: 'SEMI_MANAGED' });
    await expect(
      semi.service.create('wh-1', { ...dto, fulfillmentMode: 'OZON_FBP' as const }, operator),
    ).resolves.toMatchObject({ fulfillmentMode: 'OZON_FBP' as const });

    const self = buildService({ platformCode: 'OZON', warehouseType: 'SELF' });
    await expect(
      self.service.create('wh-1', { ...dto, fulfillmentMode: 'OZON_FBP' as const }, operator),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_PLATFORM_BINDING_INVALID' });

    const platform = buildService({ platformCode: 'OZON', warehouseType: 'PLATFORM' });
    await expect(
      platform.service.create('wh-1', { ...dto, fulfillmentMode: 'OZON_FBP' as const }, operator),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_PLATFORM_BINDING_INVALID' });
  });

  it('rejects a PLATFORM (托管仓) warehouse that already has a platform warehouse bound', async () => {
    const { service } = buildService({
      platformCode: 'OZON',
      warehouseType: 'PLATFORM',
      existingBindingCount: 1,
    });
    await expect(service.create('wh-1', dto, operator)).rejects.toMatchObject({
      code: 'WAREHOUSE_PLATFORM_BINDING_INVALID',
    });
  });

  it('rejects duplicate (store, platformWarehouseId) bindings', async () => {
    const { service } = buildService({
      platformCode: 'OZON',
      warehouseType: 'PLATFORM',
      existingPlatformBinding: { id: 'binding-0' },
    });
    await expect(service.create('wh-1', dto, operator)).rejects.toMatchObject({
      code: 'WAREHOUSE_PLATFORM_BINDING_INVALID',
    });
  });

  it('rejects cross-platform combinations (WB store + OZON_FBO)', async () => {
    const { service } = buildService({ platformCode: 'WB', warehouseType: 'PLATFORM' });
    await expect(service.create('wh-1', dto, operator)).rejects.toMatchObject({
      code: 'WAREHOUSE_PLATFORM_BINDING_INVALID',
    });
  });
});
