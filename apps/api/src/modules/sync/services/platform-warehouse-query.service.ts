import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';
import { SyncContextService } from './sync-context.service';
import {
  OzonWarehouseService,
  PlatformWarehouseOption,
} from '../../integration/ozon/ozon-warehouse.service';

/** 平台尚未实现仓库目录查询时的明确错误（不猜测、不返回假数据）。 */
export class PlatformWarehouseQueryUnsupportedError extends DomainError {
  readonly code = 'PLATFORM_WAREHOUSE_QUERY_UNSUPPORTED';
  readonly httpStatus = 422;

  constructor(platformCode: string) {
    super(`平台 ${platformCode} 暂不支持仓库目录查询`, { platformCode });
  }
}

/**
 * 店铺维度的平台仓库目录查询（用户指示 2026-09-17）：实时调用平台 API，
 * 不落地、不缓存——绑定快照存 warehouse_platform_bindings。
 * 当前仅 OZON 提供三个仓库目录端点；WB / YANDEX 明确报不支持。
 */
@Injectable()
export class PlatformWarehouseQueryService {
  constructor(
    private readonly syncContext: SyncContextService,
    private readonly ozonWarehouseService: OzonWarehouseService,
  ) {}

  async listByStore(storeId: string): Promise<PlatformWarehouseOption[]> {
    const { store, adapter } = await this.syncContext.resolveSyncableStore(storeId);
    if (adapter.platformCode !== 'OZON') {
      throw new PlatformWarehouseQueryUnsupportedError(adapter.platformCode);
    }
    const context = await this.syncContext.buildStoreContext(store);
    return this.ozonWarehouseService.listPlatformWarehouses({
      storeId: context.storeId,
      credential: context.credential,
    });
  }
}
