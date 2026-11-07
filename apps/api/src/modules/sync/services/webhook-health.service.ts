import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { NotificationService } from '../../notification/services/notification.service';
import { PlatformService } from '../../platform/platform.service';
import { StoreService } from '../../store/services/store.service';
import { ExternalRawEventRepository } from '../repositories/external-raw-event.repository';
import { OzonWebhookService } from './ozon-webhook.service';
import { WbWebhookService } from './wb-webhook.service';

/** 巡检周期：6 小时（进程内闸门；多进程各自跑一遍也无副作用）。 */
export const WEBHOOK_HEALTH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * 店铺之间的最小间隔：OZON 的 notification 系列接口**每秒级限速**，
 * 12 家店铺连着打（每家 list + check）会直接 429，巡检把那些店判成
 * UNKNOWN 就白跑了。6 小时一轮多等十几秒完全值得。
 */
export const WEBHOOK_HEALTH_STORE_GAP_MS = 800;

/**
 * 抽屉打开时复用最近一次结果的窗口（2026-10-27）：`/v1/notification/check`
 * 是外部调用，不能在每次渲染/切行时打一遍；只有「立即体检」才强制刷新。
 */
export const WEBHOOK_HEALTH_CACHE_MS = 5 * 60 * 1000;

/**
 * 「静默看门狗」阈值（2026-11-07）：enabled 的 OZON 订阅连续这么久没有任何
 * 入站推送（连平台探测 PING 都没有）就报异常。平台 PING 约每天 3-4 次，
 * 24 小时没有 = 链路确实断了，且比平台把订阅暂停更早一天暴露。
 */
export const WEBHOOK_SILENCE_ALERT_MS = 24 * 60 * 60 * 1000;

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
  /**
   * 本机公网自检：用 `PUBLIC_BASE_URL` 把同一个探测请求打回自己的入口
   * （与平台走同一条公网路径，2026-10-27）。平台 `check.errors` 是**滚动
   * 窗口**里的累计值，修复接收端后仍会返回旧错误，不能直接当"现在坏了"；
   * 自检失败才是真的坏了（隧道/入口/应答格式）。
   */
  selfCheck: { ok: boolean; detail: string } | null;
  /** 平台投递可用性（OZON；YELLOW/RED = 平台已在记账失败，随时会暂停）。 */
  availability: {
    status: string;
    disableReason: string | null;
    since: string | null;
    problematicType: string | null;
  } | null;
  /** 最近一次收到该店任何推送的时间（含 PING）；null = 从未收到。 */
  lastEventAt: string | null;
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
    private readonly rawEvents: ExternalRawEventRepository,
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
        if (
          result.platform === 'OZON' &&
          result.state !== 'PAUSED' &&
          result.state !== 'NOT_SUBSCRIBED' &&
          result.state !== 'UNKNOWN'
        ) {
          await this.enforceSilence(result);
        }
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
      await new Promise((resolve) => setTimeout(resolve, WEBHOOK_HEALTH_STORE_GAP_MS));
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
    const lastEventAt = await this.rawEvents
      .findLastReceivedAt(storeId)
      .catch(() => null)
      .then((value) => (value === null ? null : value.toISOString()));
    const base = {
      storeId,
      storeCode,
      platform,
      check: null,
      selfCheck: null,
      availability: null,
      lastEventAt,
    };
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
    check: null;
    selfCheck: null;
    availability: WebhookHealthResult['availability'];
    lastEventAt: string | null;
  }): Promise<Omit<WebhookHealthResult, 'checkedAt'>> {
    const getStatus = this.ozonWebhook.getStatus.bind(this.ozonWebhook);
    const check = this.ozonWebhook.check.bind(this.ozonWebhook);
    try {
      const status = await getStatus(base.storeId);
      const availability = status.availability;
      if (!status.subscribed) {
        return {
          ...base,
          availability,
          state: 'NOT_SUBSCRIBED',
          reason: '该店铺尚未订阅 OZON 推送',
          check: null,
        };
      }
      if (status.enabled === false) {
        // 平台自动暂停：不再调用 check（订阅停用后探测也可能被平台忽略）。
        const detail =
          availability?.problematicType === null || availability?.problematicType === undefined
            ? ''
            : `；平台记账的失败事件：${availability.problematicType}`;
        return {
          ...base,
          availability,
          state: 'PAUSED',
          reason: `平台已暂停该订阅（enable=false）：连续投递失败会被 OZON 自动停用${detail}`,
          check: null,
        };
      }
      const probe = await check(base.storeId);
      const selfCheck = await this.probeOwnUrl(probe.url);
      const platformErrors = probe.errors.map((error) => error.type).join(' / ');

      // 平台可用性记账（2026-11-07）：enable 还是 true 但状态已经 YELLOW/RED
      // 时提前报异常——等 enable=false 就晚了（平台已经替我们停了订阅）。
      if (
        availability !== null &&
        (availability.status === 'YELLOW' || availability.status === 'RED')
      ) {
        return {
          ...base,
          availability,
          state: 'UNHEALTHY',
          reason:
            `平台投递可用性 ${availability.status}` +
            (availability.problematicType === null
              ? ''
              : `（问题事件：${availability.problematicType}）`) +
            (availability.since === null ? '' : `，自 ${availability.since}`) +
            '：失败计数接近/超过暂停阈值，请尽快排查公网入口' +
            (selfCheck.ok
              ? `；入口自检正常（${selfCheck.detail}）`
              : `；入口自检失败（${selfCheck.detail}）`),
          check: probe,
          selfCheck,
        };
      }
      if (!selfCheck.ok) {
        return {
          ...base,
          availability,
          state: 'UNHEALTHY',
          reason:
            platformErrors === ''
              ? selfCheck.detail
              : `${selfCheck.detail}；平台记录：${platformErrors}`,
          check: probe,
          selfCheck,
        };
      }
      return {
        ...base,
        availability,
        state: 'OK',
        reason:
          platformErrors === ''
            ? '入口自检正常'
            : `入口自检正常（平台监控窗口仍含历史错误：${platformErrors}）`,
        check: probe,
        selfCheck,
      };
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
    check: null;
    selfCheck: null;
    availability: WebhookHealthResult['availability'];
    lastEventAt: string | null;
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

    // 只在「状态进入」时通知一次（2026-11-03）：巡检每 6 小时一轮，问题没恢复
    // 之前不再重复推送。此前靠 30 分钟去重键兜底，实际变成每半小时刷一条，
    // 通知中心被同一条订阅告警刷屏。异常行本身仍然保持 OPEN 并更新原因。
    if (result.state === 'PAUSED') {
      const alreadyOpen = await this.exceptionService.hasOpen({
        exceptionType: 'WEBHOOK_PAUSED',
        referenceType: 'STORE',
        referenceId: result.storeId,
      });
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
      if (!alreadyOpen) {
        await this.notification.notifyWebhookHealth({
          storeId: result.storeId,
          storeCode: result.storeCode,
          platform: result.platform,
          state: 'PAUSED',
          reason: result.reason,
        });
      }
      return;
    }

    if (result.state === 'UNHEALTHY') {
      const alreadyOpen = await this.exceptionService.hasOpen({
        exceptionType: 'WEBHOOK_UNHEALTHY',
        referenceType: 'STORE',
        referenceId: result.storeId,
      });
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
      if (!alreadyOpen) {
        await this.notification.notifyWebhookHealth({
          storeId: result.storeId,
          storeCode: result.storeCode,
          platform: result.platform,
          state: 'UNHEALTHY',
          reason: result.reason,
        });
      }
      return;
    }

    // OK / NOT_SUBSCRIBED：健康或本来就没订阅（轮询兜底），关闭历史异常。
    await resolve('WEBHOOK_PAUSED');
    await resolve('WEBHOOK_UNHEALTHY');
  }

  /**
   * 静默看门狗（2026-11-07）：订阅 enabled、平台也没标暂停，但本店 24 小时
   * 没有收到任何入站推送（连 PING 都没有）→ 链路断了，提前报异常。
   *
   * 10-30/10-31 实证：OZON 的 PING 与事件一起消失两天，同期 Yandex 正常；
   * 那时如果只看 enable，就完全看不到「投递已经断了」。
   */
  private async enforceSilence(result: WebhookHealthResult): Promise<void> {
    const last = result.lastEventAt === null ? null : Date.parse(result.lastEventAt);
    const silent = last === null || Date.now() - last > WEBHOOK_SILENCE_ALERT_MS;
    if (!silent) {
      await this.exceptionService.resolveByReference({
        exceptionType: 'WEBHOOK_SILENT',
        referenceType: 'STORE',
        referenceId: result.storeId,
      });
      return;
    }
    const alreadyOpen = await this.exceptionService.hasOpen({
      exceptionType: 'WEBHOOK_SILENT',
      referenceType: 'STORE',
      referenceId: result.storeId,
    });
    const silentHours =
      last === null ? 24 : Math.max(1, Math.floor((Date.now() - last) / (60 * 60 * 1000)));
    await this.exceptionService.create({
      exceptionType: 'WEBHOOK_SILENT',
      severity: 'MEDIUM',
      referenceType: 'STORE',
      referenceId: result.storeId,
      storeId: result.storeId,
      message: `${result.storeCode}（${result.platform}）已连续 ${silentHours} 小时未收到任何平台推送（含探测 ping）——公网回调入口或投递链路中断`,
      details: {
        storeCode: result.storeCode,
        platform: result.platform,
        lastEventAt: result.lastEventAt,
        silentHours,
        availability: result.availability,
      },
    });
    if (!alreadyOpen) {
      await this.notification.notifyWebhookSilent({
        storeId: result.storeId,
        storeCode: result.storeCode,
        platform: result.platform,
        silentHours,
        lastEventAt: result.lastEventAt,
      });
    }
  }

  /**
   * 自己打自己：POST `{}`（就是平台连通性探测的形状）到公网回调地址，
   * 期望 200 + `{version, name, time}`。5 秒超时——平台对单条通知也是这个红线。
   */
  private async probeOwnUrl(url: string): Promise<{ ok: boolean; detail: string }> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5_000),
      });
      const body = await response.text();
      if (response.status !== 200) {
        return { ok: false, detail: `回调地址返回 HTTP ${response.status}` };
      }
      const parsed = JSON.parse(body) as { version?: unknown; name?: unknown; time?: unknown };
      const shaped =
        typeof parsed.version === 'string' &&
        typeof parsed.name === 'string' &&
        typeof parsed.time === 'string';
      return shaped
        ? { ok: true, detail: '200 + 标准应答' }
        : { ok: false, detail: '应答体不是 {version,name,time}' };
    } catch (error: unknown) {
      return {
        ok: false,
        detail: `公网回调地址不可达：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async resolvePlatformCode(platformId: string): Promise<string> {
    const platform = await this.platformService.getEntityById(platformId);
    return platform?.code ?? '';
  }
}
