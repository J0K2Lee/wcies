import { Injectable } from '@nestjs/common';
import { parseOzonAuth } from './ozon.adapter';
import { OzonClient } from './ozon.client';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/** 归一化后的平台仓库条目（绑定弹窗数据源）。 */
export interface PlatformWarehouseOption {
  platformWarehouseId: string;
  name: string;
  /** WCIES 统一履约模式常量（OZON_RFBS / OZON_FBS / OZON_FBP / OZON_FBO）。 */
  fulfillmentMode: string;
  /** 仓库分类（自管仓 / 半托管 / 托管仓），来自履约模式映射。 */
  category: 'SELF_MANAGED' | 'SEMI_MANAGED' | 'MANAGED';
  /** 平台侧状态/附加信息快照（展示用）。 */
  detail: {
    status?: string | null;
    address?: string | null;
    partnerName?: string | null;
    isActive?: boolean | null;
  };
}

/**
 * OZON 平台仓库目录（用户指示 2026-09-17：仓库绑定平台仓库）。
 *
 * 三个来源（均为 2026-09-17 实测验证，见 docs/integrations/ozon.md）：
 * - /v2/warehouse/list        卖家自管仓（is_rfbs 区分 rFBS / FBS）
 * - /v1/fbp/warehouse/list    FBP 平台国内合作仓（半托管）
 * - /v1/warehouse/ozon/list   OZON 自有履约仓（FBO，按类型过滤）
 */
@Injectable()
export class OzonWarehouseService {
  constructor(
    private readonly client: OzonClient,
    private readonly logger: AppLoggerService,
  ) {}

  async listPlatformWarehouses(context: {
    storeId: string;
    credential: Readonly<Record<string, unknown>>;
  }): Promise<PlatformWarehouseOption[]> {
    const auth = parseOzonAuth(context.credential, context.storeId);

    const [sellerList, fbpList, ozonList] = await Promise.all([
      this.client.sellerWarehouseList(auth, context.storeId),
      this.client.fbpWarehouseList(auth, context.storeId).catch((error: unknown) => {
        // FBP 目录对未开通半托管的店铺可能报错：目录类查询互相独立，
        // 单一来源失败不阻塞其它来源（AGENTS.md：单点失败不扩散）。
        this.logger.warn(
          `ozon fbp warehouse list failed (store=${context.storeId}): ${String(error)}`,
          'OzonWarehouseService',
        );
        return { warehouses: [] } as const;
      }),
      this.client.ozonWarehouseList(auth, context.storeId, ['FULL_FILLMENT']),
    ]);

    const options: PlatformWarehouseOption[] = [];
    for (const warehouse of sellerList.warehouses ?? []) {
      const id = warehouse.warehouse_id;
      if (id === undefined) {
        continue;
      }
      const mode = warehouse.is_rfbs === true ? 'OZON_RFBS' : 'OZON_FBS';
      options.push({
        platformWarehouseId: String(id),
        name: warehouse.name ?? String(id),
        fulfillmentMode: mode,
        category: 'SELF_MANAGED',
        detail: {
          status: warehouse.status ?? null,
          address: warehouse.address_info?.address ?? null,
          partnerName: null,
          isActive: null,
        },
      });
    }
    for (const warehouse of fbpList.warehouses ?? []) {
      const id = warehouse.id;
      if (id === undefined) {
        continue;
      }
      options.push({
        platformWarehouseId: String(id),
        name: warehouse.name ?? String(id),
        fulfillmentMode: 'OZON_FBP',
        category: 'SEMI_MANAGED',
        detail: {
          status: null,
          address: warehouse.address_detailing?.city ?? null,
          partnerName: warehouse.partner_name ?? null,
          isActive: null,
        },
      });
    }
    for (const warehouse of ozonList.warehouses ?? []) {
      const id = warehouse.warehouse_id;
      if (id === undefined) {
        continue;
      }
      options.push({
        platformWarehouseId: String(id),
        name: warehouse.name ?? String(id),
        fulfillmentMode: 'OZON_FBO',
        category: 'MANAGED',
        detail: {
          status: null,
          address: warehouse.address ?? null,
          partnerName: null,
          isActive: warehouse.is_active ?? null,
        },
      });
    }
    return options;
  }
}
