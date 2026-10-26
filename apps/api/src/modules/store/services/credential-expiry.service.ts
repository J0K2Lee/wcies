import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { PlatformCredentialRepository } from '../repositories/platform-credential.repository';
import { NotificationService } from '../../notification/services/notification.service';
import { daysLeft } from './platform-credential.service';

/** 到期前多少天开始提醒（用户指示 2026-10-26）。 */
export const CREDENTIAL_EXPIRY_WARN_DAYS = 7;

/**
 * API Key 到期扫描（2026-10-26 用户需求）：
 *
 * - 平台可能强制 Key 过期，绑定凭证时必须声明「到期日」或「长期」；
 * - 从到期前 7 天开始，**每天**给订阅了
 *   `STORE_CREDENTIAL_EXPIRING` / `STORE_CREDENTIAL_EXPIRED` 的人推送一条；
 * - 「每天一次」由通知的去重键 `credential:<id>:<YYYY-MM-DD>` 保证，
 *   因此本扫描可以安全地频繁执行（多进程、重启都无副作用）。
 */
@Injectable()
export class CredentialExpiryService {
  /** 进程内的每日闸门：扫描本身很轻，但没必要每 30 秒查一次库。 */
  private lastScanDate: string | null = null;

  constructor(
    private readonly repository: PlatformCredentialRepository,
    private readonly notification: NotificationService,
    private readonly logger: AppLoggerService,
  ) {}

  /** 调度 tick 调用：同一本地日期只扫一次。 */
  async scanIfDue(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastScanDate === today) {
      return 0;
    }
    this.lastScanDate = today;
    return this.scan();
  }

  /** 实际扫描；返回发出的提醒条数。 */
  async scan(): Promise<number> {
    const credentials = await this.repository.listExpiringWithin(CREDENTIAL_EXPIRY_WARN_DAYS);
    let sent = 0;
    for (const credential of credentials) {
      try {
        const remaining = daysLeft(credential.expiresAt);
        if (remaining === null) {
          continue;
        }
        await this.notification.notifyCredentialExpiry({
          credentialId: credential.id,
          storeId: credential.storeId,
          storeCode: credential.storeCode,
          platform: credential.platformCode,
          credentialType: credential.credentialType,
          expiresAt: credential.expiresAt,
          daysLeft: remaining,
        });
        sent += 1;
      } catch (error: unknown) {
        // 一条凭证失败不拖垮整批（AGENTS §36）：记日志继续。
        this.logger.warn('credential expiry notify failed', {
          module: 'store',
          credentialId: credential.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return sent;
  }
}
