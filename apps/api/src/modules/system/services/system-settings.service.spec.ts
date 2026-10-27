import { describe, expect, it, vi } from 'vitest';
import { SystemSettingsService, DEFAULT_ORDER_FALLBACK_HOURS } from './system-settings.service';
import { SystemSettingRepository } from '../repositories/system-setting.repository';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { ConfigService } from '@nestjs/config';

/**
 * 系统参数（2026-10-27）：默认值在代码里，表里只存覆盖值；非法/越界值回落默认，
 * 不允许因为一次误填让回读停摆。
 */
const OPERATOR = { userId: 'u1', username: 'admin' };

function build(storedValue: Record<string, unknown> | null, envHours: number | null = null) {
  const repository = {
    find: vi.fn().mockResolvedValue(storedValue === null ? null : { key: 'x', value: storedValue }),
    upsert: vi.fn().mockResolvedValue(undefined),
  } as unknown as SystemSettingRepository;
  const operationLog = { record: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi.fn().mockReturnValue(envHours),
  } as unknown as ConfigService;
  const service = new SystemSettingsService(
    repository,
    operationLog as unknown as OperationLogService,
    config,
  );
  return { service, repository, operationLog };
}

describe('SystemSettingsService 回读阈值', () => {
  it('没有覆盖值 → 默认 2h / 12h / 24h', async () => {
    const { service } = build(null);
    await expect(service.getOrderFallbackHours()).resolves.toEqual(DEFAULT_ORDER_FALLBACK_HOURS);
  });

  it('部分覆盖时其余保持有效值', async () => {
    const { service } = build({ awaitingShipment: 1 });
    await expect(service.getOrderFallbackHours()).resolves.toEqual({
      awaitingShipment: 1,
      inTransit: 12,
      delivered: 24,
    });
  });

  it('显式 ENV 基线（三档统一）优先于代码默认值，覆盖值再压过 ENV', async () => {
    await expect(build(null, 0.008).service.getOrderFallbackHours()).resolves.toEqual({
      awaitingShipment: 0.008,
      inTransit: 0.008,
      delivered: 0.008,
    });
    await expect(
      build({ awaitingShipment: 2 }, 0.008).service.getOrderFallbackHours(),
    ).resolves.toEqual({ awaitingShipment: 2, inTransit: 0.008, delivered: 0.008 });
  });

  it('非法/越界值回落默认（不静默改成别的频率）', async () => {
    const { service } = build({
      awaitingShipment: 0,
      inTransit: 'abc',
      delivered: 10_000,
    });
    await expect(service.getOrderFallbackHours()).resolves.toEqual(DEFAULT_ORDER_FALLBACK_HOURS);
  });

  it('修改会先合并再落库，并记审计', async () => {
    const { service, repository, operationLog } = build(null);
    const next = await service.updateOrderFallbackHours({ awaitingShipment: 4 }, OPERATOR);

    expect(next).toEqual({ awaitingShipment: 4, inTransit: 12, delivered: 24 });
    expect(repository.upsert).toHaveBeenCalledWith(
      'order.platformFallbackHours',
      { awaitingShipment: 4, inTransit: 12, delivered: 24 },
      OPERATOR.userId,
    );
    expect(operationLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'SYSTEM_SETTING', action: 'UPDATE' }),
    );
  });
});
