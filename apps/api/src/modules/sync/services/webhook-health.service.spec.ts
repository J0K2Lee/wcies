import { describe, expect, it, vi } from 'vitest';
import { WebhookHealthService } from './webhook-health.service';
import { StoreService } from '../../store/services/store.service';
import { PlatformService } from '../../platform/platform.service';
import { OzonWebhookService } from './ozon-webhook.service';
import { WbWebhookService } from './wb-webhook.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { NotificationService } from '../../notification/services/notification.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/**
 * Webhook 订阅巡检（2026-10-27）：平台暂停/体检异常 → 异常中心 + 通知；
 * 恢复健康或本来未订阅 → 自动关闭历史异常；不支持查询的平台不判定。
 */
function build(options: {
  platformCode: string;
  subscribed?: boolean;
  enabled?: boolean | null;
  checkErrors?: Array<{ type: string; description: string }>;
  wb?: boolean;
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
  } as unknown as ExceptionService;
  const notification = {
    notifyWebhookHealth: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationService;
  const logger = { warn: vi.fn(), info: vi.fn() } as unknown as AppLoggerService;
  const service = new WebhookHealthService(
    storeService,
    platformService,
    ozonWebhook,
    wbWebhook,
    exceptionService,
    notification,
    logger,
  );
  return { service, exceptionService, notification, ozonWebhook };
}

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

  it('体检报错 → WEBHOOK_UNHEALTHY（MEDIUM）+ 通知，并关闭暂停异常', async () => {
    const { service, exceptionService, notification } = build({
      platformCode: 'OZON',
      checkErrors: [{ type: 'SERVER_FAULT', description: 'x' }],
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

  it('健康 → 关闭两类异常，不发通知', async () => {
    const { service, exceptionService, notification } = build({ platformCode: 'OZON' });

    await service.scan();

    expect(exceptionService.create).not.toHaveBeenCalled();
    expect(notification.notifyWebhookHealth).not.toHaveBeenCalled();
    expect(exceptionService.resolveByReference).toHaveBeenCalledTimes(2);
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
