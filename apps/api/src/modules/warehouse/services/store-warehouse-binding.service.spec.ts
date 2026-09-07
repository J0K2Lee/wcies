import { describe, expect, it, vi } from 'vitest';
import { StoreWarehouseBindingService } from './store-warehouse-binding.service';
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
  existingBinding?: unknown;
}) {
  const repository = {
    findWarehouseById: vi.fn().mockResolvedValue(makeWarehouse(opts.warehouseType)),
    findBinding: vi.fn().mockResolvedValue(opts.existingBinding ?? null),
    insertBinding: vi.fn().mockImplementation((binding: Record<string, unknown>) =>
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
    service: new StoreWarehouseBindingService(repository, storeService, operationLog),
    repository,
  };
}

describe('StoreWarehouseBindingService validation (task §45)', () => {
  it('accepts a consistent combination (OZON store + OZON_RFBS + SELF warehouse)', async () => {
    const { service } = buildService({ platformCode: 'OZON', warehouseType: 'SELF' });
    const result = await service.create(
      'store-1',
      { warehouseId: 'wh-1', fulfillmentMode: 'OZON_RFBS' },
      operator,
    );
    expect(result.fulfillmentMode).toBe('OZON_RFBS');
  });

  it('rejects WB store + OZON_FBO (platform mismatch)', async () => {
    const { service } = buildService({ platformCode: 'WB', warehouseType: 'PLATFORM' });
    await expect(
      service.create('store-1', { warehouseId: 'wh-1', fulfillmentMode: 'OZON_FBO' }, operator),
    ).rejects.toMatchObject({ code: 'STORE_WAREHOUSE_BINDING_INVALID' });
  });

  it('rejects OZON_FBO bound to a SELF warehouse (type mismatch)', async () => {
    const { service } = buildService({ platformCode: 'OZON', warehouseType: 'SELF' });
    await expect(
      service.create('store-1', { warehouseId: 'wh-1', fulfillmentMode: 'OZON_FBO' }, operator),
    ).rejects.toMatchObject({ code: 'STORE_WAREHOUSE_BINDING_INVALID' });
  });

  it('rejects OZON_RFBS bound to a PLATFORM warehouse (type mismatch)', async () => {
    const { service } = buildService({ platformCode: 'OZON', warehouseType: 'PLATFORM' });
    await expect(
      service.create('store-1', { warehouseId: 'wh-1', fulfillmentMode: 'OZON_RFBS' }, operator),
    ).rejects.toMatchObject({ code: 'STORE_WAREHOUSE_BINDING_INVALID' });
  });

  it('rejects duplicate store+warehouse+mode bindings', async () => {
    const { service } = buildService({
      platformCode: 'OZON',
      warehouseType: 'SELF',
      existingBinding: { id: 'old-binding' },
    });
    await expect(
      service.create('store-1', { warehouseId: 'wh-1', fulfillmentMode: 'OZON_RFBS' }, operator),
    ).rejects.toMatchObject({ code: 'STORE_WAREHOUSE_BINDING_INVALID' });
  });
});
