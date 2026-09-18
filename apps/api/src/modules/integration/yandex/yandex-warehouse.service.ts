import { Injectable } from '@nestjs/common';
import { PlatformWarehouseOption } from '../ozon/ozon-warehouse.service';
import { StoreCredentialMalformedError } from '../integration.errors';
import { YandexAdapter } from './yandex.adapter';
import { YandexClient, YxAuth } from './yandex.client';

/**
 * Yandex 平台仓库目录（用户指示 2026-09-17：仓库绑定平台仓库）。
 *
 * 数据源：GET /v2/businesses/{businessId}/warehouses —— 覆盖 FBS / DBS /
 * Express 卖家侧仓（docs/integrations/yandex.md §6/§8）。已知缺口：FBY
 * 平台仓不在返回结构中 —— FBY 绑定走手动录入平台仓 ID + 备注名。
 * 字段形态属 T0 校准项：解析保持容错，无法解析的行跳过不阻塞目录。
 */
@Injectable()
export class YandexWarehouseService {
  constructor(
    private readonly client: YandexClient,
    private readonly adapter: YandexAdapter,
  ) {}

  async listPlatformWarehouses(context: {
    storeId: string;
    credential: Readonly<Record<string, unknown>>;
  }): Promise<PlatformWarehouseOption[]> {
    // Identity resolution shares the adapter's rule (explicit campaignId or
    // single-campaign token) - warehouses are business-level reads.
    const auth = this.authOf(context);
    const identity = await this.adapter.resolveIdentityForContext({
      storeId: context.storeId,
      storeCode: '',
      platform: 'YANDEX',
      credential: context.credential,
    });
    const response = await this.client.businessWarehouses(auth, context.storeId, {
      businessId: identity.businessId,
    });
    // T0 校准（2026-09-18 live）：POST 分页变体响应为 {status, result:{warehouses}}。
    const warehouses = response.result?.warehouses ?? [];
    const options: PlatformWarehouseOption[] = [];
    for (const warehouse of warehouses) {
      const name =
        typeof warehouse.name === 'string' && warehouse.name !== ''
          ? warehouse.name
          : warehouse.id !== undefined
            ? String(warehouse.id)
            : null;
      if (name === null) {
        continue; // unidentifiable row: skip, never fabricate
      }
      options.push({
        platformWarehouseId: warehouse.id !== undefined ? String(warehouse.id) : name,
        name,
        // Seller-side warehouses = YANDEX_FBS (SELF_MANAGED); the FBY gap is
        // handled by manual-entry bindings.
        fulfillmentMode: 'YANDEX_FBS',
        category: 'SELF_MANAGED',
        detail: { status: null, address: null, partnerName: null, isActive: null },
      });
    }
    return options;
  }

  private authOf(context: {
    storeId: string;
    credential: Readonly<Record<string, unknown>>;
  }): YxAuth {
    const apiKey = context.credential['apiKey'];
    if (typeof apiKey !== 'string' || apiKey === '') {
      throw new StoreCredentialMalformedError(
        context.storeId,
        'YANDEX',
        'expected { apiKey, campaignId? }',
      );
    }
    return { apiKey };
  }
}
