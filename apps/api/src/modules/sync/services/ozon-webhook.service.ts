import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainError } from '../../../common/errors/domain.error';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { OzonAuth, OzonClient } from '../../integration/ozon/ozon.client';
import { PlatformApiError } from '../../integration/platform-error';
import { SyncContextService } from './sync-context.service';

/** webhook 配置缺失（PUBLIC_BASE_URL / 凭证）。 */
export class OzonWebhookConfigError extends DomainError {
  readonly code = 'OZON_WEBHOOK_CONFIG_ERROR';
  readonly httpStatus = 422;

  constructor(reason: string) {
    super(`OZON 事件订阅配置不完整：${reason}`, { reason });
  }
}

/** 订阅状态异常（同 URL 多条等），需人工处理。 */
export class OzonWebhookStateError extends DomainError {
  readonly code = 'OZON_WEBHOOK_STATE_ERROR';
  readonly httpStatus = 409;

  constructor(reason: string) {
    super(`OZON 事件订阅状态需要人工处理：${reason}`, { reason });
  }
}

/** 订阅状态视图（GET 端点直接返回）。 */
export interface OzonWebhookSubscriptionView {
  /** 本店回调 URL 是否已在 OZON 侧订阅。 */
  subscribed: boolean;
  /** OZON 侧的订阅 ID（按 URL 匹配到的记录）。 */
  subscriptionId: number | null;
  /** 本店回调 URL（配置到 OZON 的地址）。 */
  url: string;
  /** 订阅是否启用；平台自动暂停后为 false（docs §6.5）。 */
  enabled: boolean | null;
  /** 该订阅当前的事件类型（平台侧事实）。 */
  types: string[];
  /** WCIES 推荐订阅的事件类型（接收端能分类处理的集合）。 */
  expectedTypes: string[];
  /** 同一 Client-Id 下除本店 URL 外的其他订阅数量（提醒多系统共存）。 */
  otherUrlCount: number;
  /**
   * 平台投递可用性（2026-11-07）：平台侧对「连续投递失败」累计到阈值就会
   * 自动 disable。在 enable 还是 true 时提前看到 YELLOW/RED 才能抢在暂停前修。
   */
  availability: {
    status: string;
    disableReason: string | null;
    since: string | null;
    problematicType: string | null;
  } | null;
}

export interface OzonWebhookUnsubscribeResult {
  deleted: number;
  url: string;
}

/** 平台连通性体检结果（2026-10-27）。 */
export interface OzonWebhookCheckView {
  url: string;
  /** 平台探测到可用响应（拿到 200 + 标准 ack）时为 true。 */
  isActive: boolean;
  /** 失败类别（REQUEST_ERROR / STATUS_CODE_NOT_OK / SERVER_FAULT / WRONG_RESULT_FIELD…）。 */
  errors: Array<{ type: string; description: string }>;
}

/**
 * WCIES 推荐订阅的事件类型：接收端 mapWebhookPayload 能分类处理的消息
 * （docs/integrations/ozon.md §6.1；TYPE_CREATE_OR_UPDATE_ITEM 与 CREATE/UPDATE
 * 二选一，不重复订阅）。其余类型（聊天、TYPE_POSTING_SHIPPED 等）当前只落
 * UNKNOWN 事实，不默认订阅。
 */
export const OZON_WEBHOOK_EVENT_TYPES = [
  'TYPE_NEW_POSTING',
  'TYPE_POSTING_CANCELLED',
  'TYPE_STATE_CHANGED',
  'TYPE_CREATE_ITEM',
  'TYPE_UPDATE_ITEM',
  /**
   * 买家会话新消息（2026-11-02）。平台载荷字段未公开 → 只当"去拉一次"的
   * 信号，采集走 `/v3/chat/*`（buyer-feedback 模块）。加到推荐集合后，
   * 下一次「订阅/对齐事件」会把该类型一起写上；存量店铺需要显式对齐一次。
   */
  'TYPE_NEW_MESSAGE',
] as const;

/**
 * OZON push-notification 订阅管理（2026-10-09，vendored spec v2.1 verified）。
 *
 * OZON 的订阅模型是 Client-Id 级 URL 列表：`/v1/notification/list` 返回该
 * 账户下全部订阅 URL（可能含其他系统的地址），本服务只按「本店回调 URL」
 * 精确匹配操作，绝不改动其他 URL 的订阅。订阅/退订是真实平台写操作
 * （AGENTS.md §92），仅由操作员在 UI 上显式触发。
 */
@Injectable()
export class OzonWebhookService {
  constructor(
    private readonly syncContext: SyncContextService,
    private readonly operationLog: OperationLogService,
    private readonly client: OzonClient,
    private readonly config: ConfigService,
  ) {}

  /** 订阅状态（只读，不调用任何写端点）。 */
  async getStatus(storeId: string): Promise<OzonWebhookSubscriptionView> {
    const { auth, url } = await this.resolveContext(storeId);
    const subscriptions = await this.listSubscriptions(auth, storeId);
    const matches = subscriptions.filter((row) => row.url === url);
    if (matches.length === 0) {
      return {
        subscribed: false,
        subscriptionId: null,
        url,
        enabled: null,
        types: [],
        expectedTypes: [...OZON_WEBHOOK_EVENT_TYPES],
        otherUrlCount: subscriptions.length,
        availability: null,
      };
    }
    if (matches.length > 1) {
      throw new OzonWebhookStateError(
        `OZON 返回 ${matches.length} 条与本店回调地址相同的订阅（疑似平台脏数据），请到卖家后台 Settings → Push notifications 人工核查`,
      );
    }
    const match = matches[0];
    if (match === undefined) {
      return {
        subscribed: false,
        subscriptionId: null,
        url,
        enabled: null,
        types: [],
        expectedTypes: [...OZON_WEBHOOK_EVENT_TYPES],
        otherUrlCount: subscriptions.length,
        availability: null,
      };
    }
    return {
      subscribed: true,
      subscriptionId: match.id,
      url,
      enabled: match.enable === true,
      types: [...match.types],
      expectedTypes: [...OZON_WEBHOOK_EVENT_TYPES],
      otherUrlCount: subscriptions.length - 1,
      availability: {
        status: match.availabilityStatus ?? 'UNSPECIFIED',
        disableReason: match.disableReason ?? null,
        since: match.availabilityStatusDate ?? null,
        problematicType:
          match.problematicType !== undefined && match.problematicType !== ''
            ? match.problematicType
            : null,
      },
    };
  }

  /**
   * 连通性体检（2026-10-27）：让平台探测我们的回调 URL。这是平台自动暂停
   * 订阅前使用的同一套检查，因此它的 errors 就是「会被暂停的原因」。
   */
  async check(storeId: string): Promise<OzonWebhookCheckView> {
    const { auth, url } = await this.resolveContext(storeId);
    const result = await this.client.notificationCheck(auth, storeId, url);
    return {
      url,
      isActive: result.is_active === true,
      errors: (result.errors ?? []).map((error) => ({
        type: String(error.type),
        description: String(error.description ?? ''),
      })),
    };
  }

  /**
   * 订阅/对齐：把本店回调 URL 的事件类型设为 WCIES 推荐集合。
   * - 未订阅 → set（创建）；
   * - 已订阅 → update（覆盖事件类型为推荐集合；后台手动加的额外类型会被
   *   收敛为推荐集合——UI 已说明）。
   */
  async subscribe(
    storeId: string,
    operator: OperatorContext,
  ): Promise<OzonWebhookSubscriptionView> {
    const { auth, url, storeCode } = await this.resolveContext(storeId);
    const subscriptions = await this.listSubscriptions(auth, storeId);
    const matches = subscriptions.filter((row) => row.url === url);
    if (matches.length > 1) {
      throw new OzonWebhookStateError(
        `OZON 返回 ${matches.length} 条与本店回调地址相同的订阅，请先到卖家后台人工清理后重试`,
      );
    }
    const types = [...OZON_WEBHOOK_EVENT_TYPES];
    const existing = matches[0];
    try {
      if (existing === undefined) {
        await this.client.notificationSet(auth, storeId, { url, types });
      } else {
        await this.client.notificationUpdate(auth, storeId, { id: existing.id, types });
        // 平台自动暂停（docs §6.5）后 enable=false：对齐时顺带恢复。
        if (existing.enable !== true) {
          await this.client.notificationEnable(auth, storeId, {
            id: existing.id,
            enabled: true,
          });
        }
      }
    } catch (error: unknown) {
      throw this.translateSubscribeError(error, url);
    }
    await this.operationLog.record({
      entityType: 'PLATFORM_WEBHOOK',
      entityId: storeId,
      entityCode: storeCode,
      action: 'SUBSCRIBE',
      changes: { types: { from: null, to: types } },
      operator,
    });
    return this.getStatus(storeId);
  }

  /**
   * 退订：按本店回调 URL 精确匹配删除（幂等——无匹配视为已退订）。
   * 只删本店 URL，绝不动同账户下其他系统的订阅。
   */
  async unsubscribe(
    storeId: string,
    operator: OperatorContext,
  ): Promise<OzonWebhookUnsubscribeResult> {
    const { auth, url, storeCode } = await this.resolveContext(storeId);
    const subscriptions = await this.listSubscriptions(auth, storeId);
    const matches = subscriptions.filter((row) => row.url === url);
    if (matches.length === 0) {
      return { deleted: 0, url };
    }
    if (matches.length > 1) {
      throw new OzonWebhookStateError(
        `发现 ${matches.length} 条同 URL 订阅（平台规则不允许，疑似脏数据），请到卖家后台人工核查后重试`,
      );
    }
    const match = matches[0];
    if (match === undefined) {
      return { deleted: 0, url };
    }
    await this.client.notificationDelete(auth, storeId, { id: match.id });
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

  // -----------------------------------------------------------------------

  /**
   * set/update 时 OZON 会先向回调地址发 PING 探测；探测失败平台回
   * `[3] PING: REQUEST_ERROR`（2026-10-12 实测：访问日志证实探测未到达
   * WCIES，纯 OZON→回调地址的网络层失败，重试通常即恢复）。原文对
   * 操作员不可读，翻译成可行动的提示；其余平台错误原样透出。
   */
  private translateSubscribeError(error: unknown, url: string): unknown {
    if (error instanceof PlatformApiError && /PING/i.test(error.message)) {
      return new OzonWebhookConfigError(
        `订阅前的连通性检查未通过：平台 PING 探测请求未到达 WCIES（网络层失败，` +
          `非应答格式问题）。请确认回调地址 ${url} 公网可达（隧道在运行）后重试；` +
          `原始平台错误：${error.message}`,
      );
    }
    return error;
  }

  private async resolveContext(storeId: string): Promise<{
    auth: OzonAuth;
    url: string;
    storeCode: string;
  }> {
    const { store, adapter } = await this.syncContext.resolveSyncableStore(storeId);
    if (adapter.platformCode !== 'OZON') {
      throw new OzonWebhookConfigError(
        `店铺 ${store.storeCode} 不属于 OZON 平台（${adapter.platformCode}）`,
      );
    }
    const publicBaseUrl = this.config.get<string>('app.publicBaseUrl')?.replace(/\/+$/, '');
    if (publicBaseUrl === undefined || publicBaseUrl === '') {
      throw new OzonWebhookConfigError('PUBLIC_BASE_URL 未配置，无法生成回调 URL');
    }
    const context = await this.syncContext.buildStoreContext(store);
    const clientId = context.credential['clientId'];
    const apiKey = context.credential['apiKey'];
    if (typeof clientId !== 'string' || clientId === '') {
      throw new OzonWebhookConfigError('店铺缺少可用的 MAIN_API 凭证（Client ID）');
    }
    if (typeof apiKey !== 'string' || apiKey === '') {
      throw new OzonWebhookConfigError('店铺缺少可用的 MAIN_API 凭证（Api-Key）');
    }
    return {
      auth: { clientId, apiKey },
      url: `${publicBaseUrl}/api/v1/webhooks/ozon/stores/${store.storeCode}`,
      storeCode: store.storeCode,
    };
  }

  private async listSubscriptions(
    auth: OzonAuth,
    storeId: string,
  ): Promise<
    Array<{
      id: number;
      url: string;
      enable: boolean;
      types: string[];
      availabilityStatus: string | null;
      disableReason: string | null;
      availabilityStatusDate: string | null;
      problematicType: string | null;
    }>
  > {
    const response = await this.client.notificationList(auth, storeId);
    // Live shape (2026-10-12): `types` items are `{type, description}` objects,
    // not plain strings (request/response asymmetry) - normalize HERE so every
    // consumer (view DTO, missing-type diff) deals with strings only.
    return [...(response.urls ?? [])].map((row) => ({
      id: row.id,
      url: row.url,
      enable: row.enable,
      types: row.types
        .map((item) => (typeof item === 'string' ? item : item.type))
        .filter((type): type is string => typeof type === 'string' && type !== ''),
      availabilityStatus: row.availability_status ?? null,
      disableReason: row.disable_reason ?? null,
      availabilityStatusDate: row.availability_status_date ?? null,
      problematicType: row.problematic_type ?? null,
    }));
  }
}
