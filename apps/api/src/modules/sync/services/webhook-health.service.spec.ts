import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookHealthService } from './webhook-health.service';
import { StoreService } from '../../store/services/store.service';
import { PlatformService } from '../../platform/platform.service';
import { OzonWebhookService } from './ozon-webhook.service';
import { WbWebhookService } from './wb-webhook.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { NotificationService } from '../../notification/services/notification.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ExternalRawEventRepository } from '../repositories/external-raw-event.repository';

/**
 * Webhook 订阅巡检（2026-10-27）：平台暂停/体检异常 → 异常中心 + 通知；
 * 恢复健康或本来未订阅 → 自动关闭历史异常；不支持查询的平台不判定。
 */
function build(options: {
  platformCode: string;
  subscribed?: boolean;
  enabled?: boolean | null;
  checkErrors?: Array<{ type: string; description: string }>;
  /** 本机公网自检结果：默认正常（200 + 标准应答）。 */
  selfProbeOk?: boolean;
  wb?: boolean;
  /** 该 (类型, 店铺) 是否已有 OPEN 异常（用于验证「只通知一次」）。 */
  alreadyOpen?: boolean;
  /** 平台投递可用性（2026-11-07）。 */
  availability?: { status: string; problematicType?: string | null } | null;
  /** 最近一次收到推送的时间；undefined = 刚刚（健康），null = 从未收到。 */
  lastEventAt?: string | null;
}) {
  const store = {
    id: 'store-1',
    storeCode: 'ON-003',
    platformId: 'platform-1',
    status: 'ACTIVE',
  };
  const storeService = {
    listAllActive: vi.fn().mockResolvedValue([store]),
    getEntityById: vi.fn().mockResolvedValue(store),
  } as unknown as StoreService;
  const platformService = {
    getEntityById: vi.fn().mockResolvedValue({ id: 'platform-1', code: options.platformCode }),
  } as unknown as PlatformService;
  const ozonWebhook = {
    getStatus: vi.fn().mockResolvedValue({
      subscribed: options.subscribed ?? true,
      enabled: options.enabled ?? true,
      url: 'https://hook/ON-003',
      types: [],
      availability:
        options.availability === undefined
          ? { status: 'GREEN', disableReason: null, since: null, problematicType: null }
          : options.availability === null
            ? null
            : {
                status: options.availability.status,
                disableReason: null,
                since: null,
                problematicType: options.availability.problematicType ?? null,
              },
    }),
    check: vi.fn().mockResolvedValue({
      url: 'https://hook/ON-003',
      isActive: (options.checkErrors ?? []).length === 0,
      errors: options.checkErrors ?? [],
    }),
  } as unknown as OzonWebhookService;
  const wbWebhook = {
    getStatus: vi.fn().mockResolvedValue({
      subscribed: options.subscribed ?? true,
      enabled: options.enabled ?? true,
    }),
  } as unknown as WbWebhookService;
  const exceptionService = {
    create: vi.fn().mockResolvedValue({}),
    resolveByReference: vi.fn().mockResolvedValue(undefined),
    hasOpen: vi.fn().mockResolvedValue(options.alreadyOpen === true),
  } as unknown as ExceptionService;
  const notification = {
    notifyWebhookHealth: vi.fn().mockResolvedValue(undefined),
    notifyWebhookSilent: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationService;
  const rawEvents = {
    findLastReceivedAt: vi.fn().mockImplementation(() => {
      if (options.lastEventAt === null) {
        return Promise.resolve(null);
      }
      const at = options.lastEventAt === undefined ? new Date() : new Date(options.lastEventAt);
      return Promise.resolve(at);
    }),
  } as unknown as ExternalRawEventRepository;
  const logger = { warn: vi.fn(), info: vi.fn() } as unknown as AppLoggerService;
  const selfProbeOk = options.selfProbeOk ?? true;
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        selfProbeOk
          ? new Response(
              JSON.stringify({ version: '2.0', name: 'WCIES', time: '2026-10-27T10:00:00Z' }),
              { status: 200 },
            )
          : new Response('gateway error', { status: 502 }),
      ),
  );
  const service = new WebhookHealthService(
    storeService,
    platformService,
    ozonWebhook,
    wbWebhook,
    rawEvents,
    exceptionService,
    notification,
    logger,
  );
  return { service, exceptionService, notification, ozonWebhook };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebhookHealthService.scan', () => {
  it('平台暂停订阅 → WEBHOOK_PAUSED 异常 + 暂停通知，并关闭不健康异常', async () => {
    const { service, exceptionService, notification } = build({
      platformCode: 'OZON',
      enabled: false,
    });

    const result = await service.scan();

    expect(result.paused).toBe(1);
    expect(exceptionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ exceptionType: 'WEBHOOK_PAUSED', severity: 'HIGH' }),
    );
    expect(notification.notifyWebhookHealth).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'PAUSED', storeCode: 'ON-003' }),
    );
    expect(exceptionService.resolveByReference).toHaveBeenCalledWith(
      expect.objectContaining({ exceptionType: 'WEBHOOK_UNHEALTHY' }),
    );
  });

  it('入口自检失败 → WEBHOOK_UNHEALTHY（MEDIUM）+ 通知，并关闭暂停异常', async () => {
    const { service, exceptionService, notification } = build({
      platformCode: 'OZON',
      checkErrors: [{ type: 'SERVER_FAULT', description: 'x' }],
      selfProbeOk: false,
    });

    const result = await service.scan();

    expect(result.unhealthy).toBe(1);
    expect(exceptionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ exceptionType: 'WEBHOOK_UNHEALTHY', severity: 'MEDIUM' }),
    );
    expect(notification.notifyWebhookHealth).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'UNHEALTHY' }),
    );
  });

  it('异常已 OPEN 的店铺不重复发通知（2026-11-03 防刷屏）', async () => {
    const { service, exceptionService, notification } = build({
      platformCode: 'OZON',
      enabled: false,
      alreadyOpen: true,
    });

    await service.scan();

    // 异常行保持 OPEN（create 幂等返回原行），但不再重复推送。
    expect(exceptionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ exceptionType: 'WEBHOOK_PAUSED' }),
    );
    expect(notification.notifyWebhookHealth).not.toHaveBeenCalled();
  });

  it('平台可用性 YELLOW/RED（enable 仍 true）→ 提前判 UNHEALTHY 并通知', async () => {
    const { service, exceptionService, notification } = build({
      platformCode: 'OZON',
      availability: { status: 'YELLOW', problematicType: 'TYPE_STATE_CHANGED' },
    });

    const result = await service.scan();

    expect(result.unhealthy).toBe(1);
    expect(exceptionService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        exceptionType: 'WEBHOOK_UNHEALTHY',
        message: expect.stringContaining('YELLOW'),
      }),
    );
    expect(notification.notifyWebhookHealth).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'UNHEALTHY' }),
    );
  });

  it('24h 没有任何入站推送 → WEBHOOK_SILENT（含 PING 都没有）', async () => {
    const { service, exceptionService, notification } = build({
      platformCode: 'OZON',
      lastEventAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    });

    await service.scan();

    expect(exceptionService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        exceptionType: 'WEBHOOK_SILENT',
        severity: 'MEDIUM',
        message: expect.stringContaining('未收到任何平台推送'),
      }),
    );
    expect(notification.notifyWebhookSilent).toHaveBeenCalledWith(
      expect.objectContaining({ storeCode: 'ON-003' }),
    );
  });

  it('刚收到过推送 → 不报静默', async () => {
    const { service, exceptionService, notification } = build({ platformCode: 'OZON' });

    await service.scan();

    expect(
      (exceptionService.create as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(
        (call) => (call[0] as { exceptionType?: string }).exceptionType === 'WEBHOOK_SILENT',
      ),
    ).toBe(false);
    expect(notification.notifyWebhookSilent).not.toHaveBeenCalled();
  });

  it('平台仍需窗口里残留旧错误、但入口自检 200 → 判健康（不误报）', async () => {
    const { service, exceptionService, notification } = build({
      platformCode: 'OZON',
      checkErrors: [
        { type: 'WRONG_RESULT_FIELD', description: 'x' },
        { type: 'STATUS_CODE_NOT_OK', description: 'y' },
      ],
      selfProbeOk: true,
    });

    const result = await service.scan();

    expect(result.unhealthy).toBe(0);
    expect(exceptionService.create).not.toHaveBeenCalled();
    expect(notification.notifyWebhookHealth).not.toHaveBeenCalled();
    // 暂停/不健康 + 静默看门狗（推送正常 → 关闭 WEBHOOK_SILENT）。
    expect(exceptionService.resolveByReference).toHaveBeenCalledTimes(3);
  });

  it('健康 → 关闭两类异常，不发通知', async () => {
    const { service, exceptionService, notification } = build({ platformCode: 'OZON' });

    await service.scan();

    expect(exceptionService.create).not.toHaveBeenCalled();
    expect(notification.notifyWebhookHealth).not.toHaveBeenCalled();
    expect(exceptionService.resolveByReference).toHaveBeenCalledTimes(3);
  });

  it('未订阅不是故障：不建异常、不发通知', async () => {
    const { service, exceptionService, notification } = build({
      platformCode: 'OZON',
      subscribed: false,
    });

    const result = await service.scan();

    expect(result.paused).toBe(0);
    expect(exceptionService.create).not.toHaveBeenCalled();
    expect(notification.notifyWebhookHealth).not.toHaveBeenCalled();
  });

  it('WB 也支持暂停判定', async () => {
    const { service, exceptionService } = build({
      platformCode: 'WB',
      enabled: false,
      wb: true,
    });

    const result = await service.scan();

    expect(result.paused).toBe(1);
    expect(exceptionService.create).toHaveBeenCalledWith(
      expect.objectContaining({ exceptionType: 'WEBHOOK_PAUSED' }),
    );
  });

  it('不支持查询订阅的平台（Yandex）不判定、不写异常', async () => {
    const { service, exceptionService } = build({ platformCode: 'YANDEX' });

    const result = await service.scan();

    expect(result.paused).toBe(0);
    expect(result.unhealthy).toBe(0);
    expect(exceptionService.create).not.toHaveBeenCalled();
    expect(exceptionService.resolveByReference).not.toHaveBeenCalled();
  });
});

/**
 * 抽屉打开读缓存（2026-10-27）：`/v1/notification/check` 是外部调用，
 * 每次渲染都打一遍既慢又吃限速；只有「立即体检」（force）才重新探测。
 */
describe('WebhookHealthService.checkStore', () => {
  it('5 分钟内复用缓存，不重复探测平台', async () => {
    const { service, ozonWebhook } = build({ platformCode: 'OZON' });

    const first = await service.checkStore('store-1');
    const second = await service.checkStore('store-1');

    expect(second).toEqual(first);
    expect(ozonWebhook.getStatus).toHaveBeenCalledTimes(1);
    expect(ozonWebhook.check).toHaveBeenCalledTimes(1);
  });

  it('force 时重新探测并刷新缓存', async () => {
    const { service, ozonWebhook } = build({ platformCode: 'OZON' });

    await service.checkStore('store-1');
    const forced = await service.checkStore('store-1', { force: true });

    expect(ozonWebhook.getStatus).toHaveBeenCalledTimes(2);
    expect(service.getLastResult('store-1')).toEqual(forced);
    expect(forced.checkedAt).not.toBe('');
  });

  it('没有体检过时 getLastResult 返回 null', () => {
    const { service } = build({ platformCode: 'OZON' });
    expect(service.getLastResult('store-1')).toBeNull();
  });
});
