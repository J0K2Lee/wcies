import { Injectable } from '@nestjs/common';
import { SyncContextService } from './sync-context.service';
import {
  OzonWarehouseService,
  PlatformWarehouseOption,
} from '../../integration/ozon/ozon-warehouse.service';
import { YandexWarehouseService } from '../../integration/yandex/yandex-warehouse.service';
import { PlatformCapabilityUnsupportedError } from '../../integration/integration.errors';

/**
 * 店铺维度的平台仓库目录查询（用户指示 2026-09-17）：按平台分发到各自
 * 的仓库目录实现（实时调用平台 API，不落地、不缓存——绑定快照存
 * warehouse_platform_bindings）。
 *
 * - OZON：三端点目录（自管 rFBS/FBS + FBP + FBO）；
 * - YANDEX：FBS/DBS 卖家侧仓（FBY 平台仓数据源缺口 → 手动录入平台仓 ID）；
 * - WB：平台仓数据源未验证（docs/integrations/wildberries.md §6）→ 显式
 *   不支持，前端走手动录入模式，T0 验证后补。
 */
@Injectable()
export class PlatformWarehouseQueryService {
  constructor(
    private readonly syncContext: SyncContextService,
    private readonly ozonWarehouseService: OzonWarehouseService,
    private readonly yandexWarehouseService: YandexWarehouseService,
  ) {}

  async listByStore(storeId: string): Promise<PlatformWarehouseOption[]> {
    const { store, adapter } = await this.syncContext.resolveSyncableStore(storeId);
    const context = await this.syncContext.buildStoreContext(store);
    switch (adapter.platformCode) {
      case 'OZON':
        return this.ozonWarehouseService.listPlatformWarehouses({
          storeId: context.storeId,
          credential: context.credential,
        });
      case 'YANDEX':
        return this.yandexWarehouseService.listPlatformWarehouses({
          storeId: context.storeId,
          credential: context.credential,
        });
      default:
        throw new PlatformCapabilityUnsupportedError(
          adapter.platformCode,
          '仓库目录查询',
          '该平台暂无已验证的平台仓列表接口（WB_FBW 数据源待 T0 验证），请使用手动录入平台仓库 ID',
        );
    }
  }
}
