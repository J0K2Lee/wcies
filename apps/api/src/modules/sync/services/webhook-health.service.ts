import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { NotificationService } from '../../notification/services/notification.service';
import { PlatformService } from '../../platform/platform.service';
import { StoreService } from '../../store/services/store.service';
import { OzonWebhookService } from './ozon-webhook.service';
import { WbWebhookService } from './wb-webhook.service';

/** 巡检周期：6 小时（进程内闸门；多进程各自跑一遍也无副作用）。 */
export const WEBHOOK_HEALTH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * 抽屉打开时复用最近一次结果的窗口（2026-10-27）：`/v1/notification/check`
 * 是外部调用，不能在每次渲染/切行时打一遍；只有「立即体检」才强制刷新。
 */
export const WEBHOOK_HEALTH_CACHE_MS = 5 * 60 * 1000;

export type WebhookHealthState =
  | 'OK'
  | 'NOT_SUBSCRIBED'
  | 'PAUSED'
  | 'UNHEALTHY'
  /** 平台不支持查询订阅状态（Yandex 等）——不判定、不告警。 */
  | 'UNSUPPORTED'
  /** 查询本身失败（网络/凭证）：不改变既有异常，等下一轮。 */
  | 'UNKNOWN';

export interface WebhookHealthResult {
  storeId: string;
  storeCode: string;
  platform: string;
  state: WebhookHealthState;
  /** 人可读的原因（进异常详情与通知正文）。 */
  reason: string;
  /** 本次体检完成时间（ISO）：UI 用它说明结果的时效。 */
  checkedAt: string;
  /** OZON 平台体检明细（其它平台为 null）。 */
  check: { isActive: boolean; errors: Array<{ type: string; description: string }> } | null;
}

/**
 * Webhook 订阅健康巡检（2026-10-27）。
 *
 * 背景：OZON 的连通性探测请求此前被我们判成畸形并回 502，平台按
 * SERVER_FAULT 记账，累计后**自动暂停了整个订阅**（ON-002 / ON-003 实证），
 * 而系统里没有任何地方会发现"推送停了"——只能靠人打开店铺抽屉。
 *
 * 规则（用户确认「暂停要进异常中心」）：
 * - 平台把订阅暂停（`enable=false`）→ 异常 `WEBHOOK_PAUSED`(HIGH) + 通知；
 * - 平台体检报错（errors 非空）→ 异常 `WEBHOOK_UNHEALTHY`(MEDIUM) + 通知；
 * - 恢复健康 / 本来就未订阅 → 关闭上述异常（未订阅不是故障，轮询兜底）。
 *
 * 任何单店失败只记日志，绝不影响其它店铺与同步调度。
 */
@Injectable()
export class WebhookHealthService {
  private lastScanAt = 0;
  /** 每店最近一次体检结果（进程内缓存，见 WEBHOOK_HEALTH_CACHE_MS）。 */
  private readonly results = new Map<string, WebhookHealthResult>();

  constructor(
    private readonly storeService: StoreService,
    private readonly platformService: PlatformService,
    private readonly ozonWebhook: OzonWebhookService,
    private readonly wbWebhook: WbWebhookService,
    private readonly exceptionService: ExceptionService,
    private readonly notification: NotificationService,
    private readonly logger: AppLoggerService,
  ) {}

  /** 调度 tick 调用：每 6 小时扫一轮。 */
  async scanIfDue(): Promise<{ scanned: number; paused: number; unhealthy: number }> {
    if (Date.now() - this.lastScanAt < WEBHOOK_HEALTH_INTERVAL_MS) {
      return { scanned: 0, paused: 0, unhealthy: 0 };
    }
    this.lastScanAt = Date.now();
    return this.scan();
  }

  /** 实际扫描（也供诊断脚本直接调用）。 */
  async scan(): Promise<{ scanned: number; paused: number; unhealthy: number }> {
    const stores = await this.storeService.listAllActive();
    let paused = 0;
    let unhealthy = 0;
    for (const store of stores) {
      try {
        const result = await this.inspect(store.id, store.storeCode, store.platformId);
        this.remember(result);
        if (result.state === 'UNSUPPORTED') {
          continue;
        }
        await this.enforce(result);
        if (result.state === 'PAUSED') {
          paused += 1;
        }
        if (result.state === 'UNHEALTHY') {
          unhealthy += 1;
        }
      } catch (error: unknown) {
        this.logger.warn('webhook health check failed for one store', {
          module: 'sync',
          storeId: store.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { scanned: stores.length, paused, unhealthy };
  }

  /**
   * 单店体检：抽屉打开时读缓存（5 分钟内复用），「立即体检」传 force。
   * 只读、无副作用——落异常/通知只发生在定时 scan() 里，避免 UI 反复点击
   * 触发重复告警。
   */
  async checkStore(storeId: string, options?: { force?: boolean }): Promise<WebhookHealthResult> {
    if (options?.force !== true) {
      const cached = this.results.get(storeId);
      if (
        cached !== undefined &&
        Date.now() - Date.parse(cached.checkedAt) < WEBHOOK_HEALTH_CACHE_MS
      ) {
        return cached;
      }
    }
    const store = await this.storeService.getEntityById(storeId);
    if (store === null) {
      throw new Error(`store not found: ${storeId}`);
    }
    const platform = await this.resolvePlatformCode(store.platformId);
    const result = await this.inspect(store.id, store.storeCode, store.platformId, platform);
    this.remember(result);
    return result;
  }

  /** 缓存结果（未体检过返回 null，UI 据此提示「尚未体检」）。 */
  getLastResult(storeId: string): WebhookHealthResult | null {
    return this.results.get(storeId) ?? null;
  }

  private remember(result: WebhookHealthResult): void {
    this.results.set(result.storeId, result);
  }

  private async inspect(
    storeId: string,
    storeCode: string,
    platformId: string,
    knownPlatformCode?: string,
  ): Promise<WebhookHealthResult> {
    const platform = knownPlatformCode ?? (await this.resolvePlatformCode(platformId));
    const base = { storeId, storeCode, platform, check: null };
    const partial =
      platform === 'OZON'
        ? await this.inspectOzon(base)
        : platform === 'WB' || platform === 'WILDBERRIES'
          ? await this.inspectWb(base)
          : { ...base, state: 'UNSUPPORTED' as const, reason: `${platform} 不支持查询订阅健康` };
    return { ...partial, checkedAt: new Date().toISOString() };
  }

  private async inspectOzon(base: {
    storeId: string;
    storeCode: string;
    platform: string;
  }): Promise<Omit<WebhookHealthResult, 'checkedAt'>> {
    const getStatus = this.ozonWebhook.getStatus.bind(this.ozonWebhook);
    const check = this.ozonWebhook.check.bind(this.ozonWebhook);
    try {
      const status = await getStatus(base.storeId);
      if (!status.subscribed) {
        return {
          ...base,
          state: 'NOT_SUBSCRIBED',
          reason: '该店铺尚未订阅 OZON 推送',
          check: null,
        };
      }
      if (status.enabled === false) {
        // 平台自动暂停：不再调用 check（订阅停用后探测也可能被平台忽略）。
        return {
          ...base,
          state: 'PAUSED',
          reason: '平台已暂停该订阅（enable=false）：连续投递失败会被 OZON 自动停用',
          check: null,
        };
      }
      const probe = await check(base.storeId);
      if (probe.errors.length > 0 || !probe.isActive) {
        const reason = probe.errors.map((error) => error.type).join(' / ') || '平台探测不可用';
        return { ...base, state: 'UNHEALTHY', reason, check: probe };
      }
      return { ...base, state: 'OK', reason: '探测正常', check: probe };
    } catch (error: unknown) {
      return {
        ...base,
        state: 'UNKNOWN',
        reason: `查询订阅状态失败：${error instanceof Error ? error.message : String(error)}`,
        check: null,
      };
    }
  }

  private async inspectWb(base: {
    storeId: string;
    storeCode: string;
    platform: string;
  }): Promise<Omit<WebhookHealthResult, 'checkedAt'>> {
    try {
      const status = await this.wbWebhook.getStatus(base.storeId);
      if (!status.subscribed) {
        return { ...base, state: 'NOT_SUBSCRIBED', reason: '该店铺尚未订阅 WB 推送', check: null };
      }
      if (status.enabled === false) {
        return {
          ...base,
          state: 'PAUSED',
          reason: '平台已暂停该订阅（enabled=false）',
          check: null,
        };
      }
      return { ...base, state: 'OK', reason: '订阅启用', check: null };
    } catch (error: unknown) {
      return {
        ...base,
        state: 'UNKNOWN',
        reason: `查询订阅状态失败：${error instanceof Error ? error.message : String(error)}`,
        check: null,
      };
    }
  }

  /** 把体检结果落到异常中心 + 通知（幂等：一店一类型一条 OPEN）。 */
  private async enforce(result: WebhookHealthResult): Promise<void> {
    if (result.state === 'UNKNOWN' || result.state === 'UNSUPPORTED') {
      return;
    }
    const resolve = (exceptionType: 'WEBHOOK_PAUSED' | 'WEBHOOK_UNHEALTHY') =>
      this.exceptionService.resolveByReference({
        exceptionType,
        referenceType: 'STORE',
        referenceId: result.storeId,
      });

    if (result.state === 'PAUSED') {
      await this.exceptionService.create({
        exceptionType: 'WEBHOOK_PAUSED',
        severity: 'HIGH',
        referenceType: 'STORE',
        referenceId: result.storeId,
        storeId: result.storeId,
        message: `${result.storeCode}（${result.platform}）的推送订阅已被平台暂停：${result.reason}`,
        details: { storeCode: result.storeCode, platform: result.platform, reason: result.reason },
      });
      await resolve('WEBHOOK_UNHEALTHY');
      await this.notification.notifyWebhookHealth({
        storeId: result.storeId,
        storeCode: result.storeCode,
        platform: result.platform,
        state: 'PAUSED',
        reason: result.reason,
      });
      return;
    }

    if (result.state === 'UNHEALTHY') {
      await this.exceptionService.create({
        exceptionType: 'WEBHOOK_UNHEALTHY',
        severity: 'MEDIUM',
        referenceType: 'STORE',
        referenceId: result.storeId,
        storeId: result.storeId,
        message: `${result.storeCode}（${result.platform}）的推送体检异常：${result.reason}`,
        details: {
          storeCode: result.storeCode,
          platform: result.platform,
          reason: result.reason,
          errors: result.check?.errors ?? [],
        },
      });
      await resolve('WEBHOOK_PAUSED');
      await this.notification.notifyWebhookHealth({
        storeId: result.storeId,
        storeCode: result.storeCode,
        platform: result.platform,
        state: 'UNHEALTHY',
        reason: result.reason,
      });
      return;
    }

    // OK / NOT_SUBSCRIBED：健康或本来就没订阅（轮询兜底），关闭历史异常。
    await resolve('WEBHOOK_PAUSED');
    await resolve('WEBHOOK_UNHEALTHY');
  }

  private async resolvePlatformCode(platformId: string): Promise<string> {
    const platform = await this.platformService.getEntityById(platformId);
    return platform?.code ?? '';
  }
}
