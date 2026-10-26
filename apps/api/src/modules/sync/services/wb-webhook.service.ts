import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainError } from '../../../common/errors/domain.error';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { PlatformCredentialService } from '../../store/services/platform-credential.service';
import { WbClient, WbWebhookAuth } from '../../integration/wildberries/wb.client';
import { extractWebhookSecret } from '../../integration/wildberries/types/api.types';
import { SyncContextService } from './sync-context.service';

/** webhook 配置缺失（PUBLIC_BASE_URL / 服务密钥）。 */
export class WbWebhookConfigError extends DomainError {
  readonly code = 'WB_WEBHOOK_CONFIG_ERROR';
  readonly httpStatus = 422;

  constructor(reason: string) {
    super(`WB webhook 订阅配置不完整：${reason}`, { reason });
  }
}

/** webhook 状态不一致（本地 secret 缺失 / 同 URL 多条），需人工处理。 */
export class WbWebhookStateError extends DomainError {
  readonly code = 'WB_WEBHOOK_STATE_ERROR';
  readonly httpStatus = 409;

  constructor(reason: string) {
    super(`WB webhook 状态需要人工处理：${reason}`, { reason });
  }
}

/** 订阅状态视图（不含 secret 本体）。 */
export interface WbWebhookSubscriptionView {
  subscribed: boolean;
  webhookId: string | null;
  url: string;
  enabled: boolean | null;
  /** 已订阅的平台事件（scope/event 对）。 */
  subscriptions: { scope: string; event: string }[];
  /** 本地是否保存了用于验证入站推送的 WEBHOOK secret。 */
  secretConfigured: boolean;
}

export interface WbWebhookUnsubscribeResult {
  deleted: number;
  url: string;
}

/** WCIES 订阅的平台事件（content 域；当前目录无订单类事件，docs §Available events）。 */
const WB_WEBHOOK_SUBSCRIPTIONS = [
  { scope: 'content', event: 'card_changed' },
  { scope: 'content', event: 'card_creation_error' },
] as const;

/**
 * WB webhook 订阅管理（2026-09-18，docs verified）。
 *
 * WB 与 OZON/Yandex 不同：webhook 通过 API 创建（不是卖家后台 UI），且：
 * - 需要 WCIES 服务密钥（X-Client-Secret，来自解决方案目录注册，env
 *   WB_WEBHOOKS_SERVICE_SECRET）+ 店铺的 seller token；
 * - 创建响应中的 webhook secret 仅此一次展示 —— 立即加密落库为店铺的
 *   WEBHOOK 凭证（AGENTS.md §28/§29），入站推送用它验证 Authorization 头；
 * - URL 创建后不可改，重订阅必须先删旧 webhook；
 * - Webhook API 全方法共限 1 req/s（client 的 webhooks 车道已限速）。
 *
 * 事件目录（card_changed 等）不含订单事件 —— 订单同步的兜底仍是轮询调度器；
 * 入站链路的处理器行为与 OZON 的 ITEM_CHANGED 一致（记录事实，不驱动动作）。
 */
@Injectable()
export class WbWebhookService {
  constructor(
    private readonly syncContext: SyncContextService,
    private readonly credentialService: PlatformCredentialService,
    private readonly operationLog: OperationLogService,
    private readonly client: WbClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * 订阅：在 WB 侧创建 webhook（幂等——已存在且本地有 secret 时直接返回），
   * 并把一次性 secret 加密落库为店铺 WEBHOOK 凭证（操作日志只记元数据）。
   */
  async subscribe(storeId: string, operator: OperatorContext): Promise<WbWebhookSubscriptionView> {
    const { auth, url, storeCode } = await this.resolveContext(storeId);

    const existing = await this.client.listWebhooks(auth, storeId);
    const match = existing.find((webhook) => webhook.url === url);
    if (match !== undefined) {
      const localSecret = await this.readLocalSecret(storeId);
      if (localSecret === null) {
        throw new WbWebhookStateError(
          `该 URL 已在 WB 侧订阅（webhook ${String(match.id ?? '?')}），但本地未保存创建时一次性展示的 secret。` +
            '请先在 WB 侧删除该 webhook 后重新订阅，或手工配置 WEBHOOK 凭证 { "secret": "..." }。',
        );
      }
      return this.view(match, url, true);
    }

    const created = await this.client.createWebhook(auth, storeId, {
      enabled: true,
      url,
      name: `WCIES ${storeCode}`.slice(0, 60),
      subscriptions: WB_WEBHOOK_SUBSCRIPTIONS.map((row) => ({ ...row })),
    });
    // The secret is shown EXACTLY once (docs §Core rules) - fail loudly
    // rather than persist a webhook whose secret nobody can ever retrieve.
    const secret = extractWebhookSecret(created);
    if (secret === null) {
      throw new WbWebhookStateError(
        'WB 创建响应中未找到 secret 字段（响应结构属 T0 校准项）。' +
          'webhook 可能已在 WB 侧创建：请到 WB 侧删除后重试，或手工录入 secret。',
      );
    }
    await this.upsertLocalSecret(storeId, secret, operator);
    await this.operationLog.record({
      entityType: 'PLATFORM_WEBHOOK',
      entityId: storeId,
      entityCode: storeCode,
      action: 'SUBSCRIBE',
      changes: { url: { from: null, to: url } },
      operator,
    });

    const webhookId = readId(created['id']);
    return {
      subscribed: true,
      webhookId,
      url,
      enabled: created['enabled'] === true,
      subscriptions: WB_WEBHOOK_SUBSCRIPTIONS.map((row) => ({ ...row })),
      secretConfigured: true,
    };
  }

  /**
   * 退订：按 URL 精确匹配删除 WB 侧 webhook（幂等——无匹配视为已退订）。
   * 多条匹配或无 URL 字段一律报错转人工，绝不盲删。本地 WEBHOOK secret
   * 保留（审计痕迹）；重新订阅时会被新 secret 覆盖。
   */
  async unsubscribe(
    storeId: string,
    operator: OperatorContext,
  ): Promise<WbWebhookUnsubscribeResult> {
    const { auth, url, storeCode } = await this.resolveContext(storeId);
    const existing = await this.client.listWebhooks(auth, storeId);
    const matches = existing.filter((webhook) => webhook.url === url);
    if (matches.length === 0) {
      return { deleted: 0, url };
    }
    if (matches.length > 1) {
      throw new WbWebhookStateError(
        `发现 ${matches.length} 条同 URL webhook（平台规则不允许，疑似脏数据），请到 WB 卖家后台人工核查后重试`,
      );
    }
    const match = matches[0];
    const id = readId(match?.id);
    if (id === null) {
      throw new WbWebhookStateError('webhook 记录缺少 id 字段（响应结构属 T0 校准项），拒绝盲删');
    }
    await this.client.deleteWebhook(auth, storeId, id);
    await this.operationLog.record({
      entityType: 'PLATFORM_WEBHOOK',
      entityId: storeId,
      entityCode: storeCode,
      action: 'UNSUBSCRIBE',
      changes: { url: { from: url, to: null } },
      operator,
    });
    return { deleted: 1, url };
  }

  /** 订阅状态（只读；不调用平台时 localSecret 仍来自本地凭证）。 */
  async getStatus(storeId: string): Promise<WbWebhookSubscriptionView> {
    const { auth, url } = await this.resolveContext(storeId);
    const existing = await this.client.listWebhooks(auth, storeId);
    const match = existing.find((webhook) => webhook.url === url);
    if (match === undefined) {
      return {
        subscribed: false,
        webhookId: null,
        url,
        enabled: null,
        subscriptions: [],
        secretConfigured: (await this.readLocalSecret(storeId)) !== null,
      };
    }
    return this.view(match, url, (await this.readLocalSecret(storeId)) !== null);
  }

  // -----------------------------------------------------------------------

  private async resolveContext(storeId: string): Promise<{
    auth: WbWebhookAuth;
    url: string;
    storeCode: string;
  }> {
    const { store, adapter } = await this.syncContext.resolveSyncableStore(storeId);
    if (adapter.platformCode !== 'WB') {
      throw new WbWebhookConfigError(
        `店铺 ${store.storeCode} 不属于 WB 平台（${adapter.platformCode}）`,
      );
    }
    const publicBaseUrl = this.config.get<string>('app.publicBaseUrl')?.replace(/\/+$/, '');
    if (publicBaseUrl === undefined || publicBaseUrl === '') {
      throw new WbWebhookConfigError('PUBLIC_BASE_URL 未配置，无法生成回调 URL');
    }
    const serviceSecret = this.config.get<string>('WB_WEBHOOKS_SERVICE_SECRET');
    if (serviceSecret === undefined || serviceSecret === '') {
      throw new WbWebhookConfigError(
        'WB_WEBHOOKS_SERVICE_SECRET 未配置（WCIES 在 WB 解决方案目录注册后获得的服务密钥）',
      );
    }
    const context = await this.syncContext.buildStoreContext(store);
    const apiKey = context.credential['apiKey'];
    if (typeof apiKey !== 'string' || apiKey === '') {
      throw new WbWebhookConfigError('店铺缺少可用的 MAIN_API 凭证（seller token）');
    }
    return {
      auth: { apiKey, serviceSecret },
      url: `${publicBaseUrl}/api/v1/webhooks/wb/stores/${store.storeCode}`,
      storeCode: store.storeCode,
    };
  }

  private async readLocalSecret(storeId: string): Promise<string | null> {
    const payload = await this.credentialService.getDecryptedActivePayload(storeId, 'WEBHOOK');
    const secret = payload?.['secret'];
    return typeof secret === 'string' && secret !== '' ? secret : null;
  }

  private async upsertLocalSecret(
    storeId: string,
    secret: string,
    operator: OperatorContext,
  ): Promise<void> {
    const meta = await this.credentialService.getValidationMeta(storeId, 'WEBHOOK');
    if (meta === null) {
      await this.credentialService.create(
        storeId,
        { credentialType: 'WEBHOOK', payload: { secret } },
        operator,
      );
      return;
    }
    await this.credentialService.updatePayload(
      storeId,
      meta.credentialId,
      { payload: { secret } },
      operator,
    );
  }

  private view(
    webhook: {
      id?: number | string;
      enabled?: boolean;
      subscriptions?: readonly { scope?: string; event?: string }[];
    },
    url: string,
    secretConfigured: boolean,
  ): WbWebhookSubscriptionView {
    return {
      subscribed: true,
      webhookId: readId(webhook.id),
      url,
      enabled: webhook.enabled === true ? true : webhook.enabled === false ? false : null,
      subscriptions: (webhook.subscriptions ?? []).map((row) => ({
        scope: typeof row.scope === 'string' ? row.scope : '',
        event: typeof row.event === 'string' ? row.event : '',
      })),
      secretConfigured,
    };
  }
}

function readId(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}
