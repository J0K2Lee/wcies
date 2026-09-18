import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WbClient, WB_DEFAULT_BASE_URLS, WB_DEFAULT_OPTIONS, WbDomain } from './wb.client';

/**
 * Builds WbClient instances from validated env config. Per-domain base URLs
 * exist so integration tests (and the .cn mirror / sandbox runs) can point
 * the client at a local mock server instead of the real platform.
 */
@Injectable()
export class WbClientFactory {
  constructor(private readonly config: ConfigService) {}

  create(): WbClient {
    return new WbClient({
      baseUrls: this.baseUrls(),
      timeoutMs: numberEnv(this.config, 'WB_TIMEOUT_MS', WB_DEFAULT_OPTIONS.timeoutMs),
      maxRetries: numberEnv(this.config, 'WB_MAX_RETRIES', WB_DEFAULT_OPTIONS.maxRetries),
      perStoreMinIntervalMs: numberEnv(
        this.config,
        'WB_MIN_REQUEST_INTERVAL_MS',
        WB_DEFAULT_OPTIONS.perStoreMinIntervalMs,
      ),
      statisticsMinIntervalMs: numberEnv(
        this.config,
        'WB_STATISTICS_MIN_INTERVAL_MS',
        WB_DEFAULT_OPTIONS.statisticsMinIntervalMs,
      ),
      webhooksMinIntervalMs: numberEnv(
        this.config,
        'WB_WEBHOOKS_MIN_INTERVAL_MS',
        WB_DEFAULT_OPTIONS.webhooksMinIntervalMs,
      ),
      marketplace4xxPenaltyMs: numberEnv(
        this.config,
        'WB_MARKETPLACE_4XX_PENALTY_MS',
        WB_DEFAULT_OPTIONS.marketplace4xxPenaltyMs,
      ),
    });
  }

  baseUrls(): Record<WbDomain, string> {
    const result = { ...WB_DEFAULT_BASE_URLS };
    for (const domain of Object.keys(WB_DEFAULT_BASE_URLS) as WbDomain[]) {
      const envKey = `WB_${domain.toUpperCase()}_API_BASE_URL`;
      const configured = this.config.get<string>(envKey)?.replace(/\/+$/, '');
      if (configured !== undefined && configured !== '') {
        result[domain] = configured;
        continue;
      }
      // Safety guard: automated tests must never reach the real platform by
      // accident - an unroutable placeholder fails fast instead.
      if (this.config.get<string>('NODE_ENV') === 'test') {
        result[domain] = `http://127.0.0.1:9/wb-${domain}-not-configured`;
      }
    }
    return result;
  }
}

function numberEnv(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
