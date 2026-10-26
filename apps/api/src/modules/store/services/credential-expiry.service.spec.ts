import { describe, expect, it, vi } from 'vitest';
import { CredentialExpiryService } from './credential-expiry.service';
import { PlatformCredentialRepository } from '../repositories/platform-credential.repository';
import { NotificationService } from '../../notification/services/notification.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/**
 * API Key 到期提醒（2026-10-26 用户需求）：
 * - 到期前 7 天开始，每天一条；过期后按「已过期」继续提醒；
 * - 「每天一次」由通知去重键保证，扫描可以安全地频繁执行。
 */
function build(rows: Array<Record<string, unknown>>) {
  const repository = {
    listExpiringWithin: vi.fn().mockResolvedValue(rows),
  } as unknown as PlatformCredentialRepository;
  const notification = {
    notifyCredentialExpiry: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationService;
  const logger = { warn: vi.fn(), info: vi.fn() } as unknown as AppLoggerService;
  const service = new CredentialExpiryService(repository, notification, logger);
  return { service, repository, notification };
}

const inDays = (days: number): Date => new Date(Date.now() + days * 86_400_000);

const base = {
  storeId: 'store-1',
  storeCode: 'ON-002',
  platformCode: 'OZON',
  credentialType: 'MAIN_API',
};

describe('CredentialExpiryService', () => {
  it('7 天内的凭证各发一条提醒，携带剩余天数', async () => {
    const { service, notification, repository } = build([
      { ...base, id: 'cred-1', expiresAt: inDays(3) },
      { ...base, id: 'cred-2', storeCode: 'WS-001', platformCode: 'WB', expiresAt: inDays(7) },
    ]);
    const sent = await service.scan();
    expect(sent).toBe(2);
    expect(repository.listExpiringWithin).toHaveBeenCalledWith(7);
    expect(notification.notifyCredentialExpiry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ credentialId: 'cred-1', platform: 'OZON', daysLeft: 3 }),
    );
  });

  it('已过期的凭证按负数天数上报（由通知层归为「已过期」事件）', async () => {
    const { service, notification } = build([{ ...base, id: 'cred-3', expiresAt: inDays(-2) }]);
    await service.scan();
    expect(notification.notifyCredentialExpiry).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'cred-3', daysLeft: -2 }),
    );
  });

  it('单条失败不拖垮整批', async () => {
    const { service, notification } = build([
      { ...base, id: 'cred-1', expiresAt: inDays(1) },
      { ...base, id: 'cred-2', expiresAt: inDays(2) },
    ]);
    vi.mocked(notification.notifyCredentialExpiry)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const sent = await service.scan();
    expect(sent).toBe(1);
    expect(notification.notifyCredentialExpiry).toHaveBeenCalledTimes(2);
  });

  it('同一进程同一天只扫一次（每天一条，不重复）', async () => {
    const { service, repository } = build([{ ...base, id: 'cred-1', expiresAt: inDays(2) }]);
    await service.scanIfDue();
    await service.scanIfDue();
    expect(repository.listExpiringWithin).toHaveBeenCalledTimes(1);
  });
});
