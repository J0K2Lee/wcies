import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OzonClient, OZON_DEFAULT_OPTIONS } from './ozon.client';

/**
 * Builds OzonClient instances from validated env config (task §30: sync
 * frequencies / limits are configurable, never hard-coded in services).
 *
 * OZON_API_BASE_URL exists so integration tests (and future sandbox runs)
 * can point the client at a local mock server instead of the real platform.
 */
export interface OzonClientConfig {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly perStoreMinIntervalMs: number;
}

@Injectable()
export class OzonClientFactory {
  constructor(private readonly config: ConfigService) {}

  create(): OzonClient {
    return new OzonClient({
      baseUrl: this.baseUrl(),
      timeoutMs: numberEnv(this.config, 'OZON_TIMEOUT_MS', OZON_DEFAULT_OPTIONS.timeoutMs),
      maxRetries: numberEnv(this.config, 'OZON_MAX_RETRIES', OZON_DEFAULT_OPTIONS.maxRetries),
      perStoreMinIntervalMs: numberEnv(
        this.config,
        'OZON_MIN_REQUEST_INTERVAL_MS',
        OZON_DEFAULT_OPTIONS.perStoreMinIntervalMs,
      ),
    });
  }

  baseUrl(): string {
    return (
      this.config.get<string>('OZON_API_BASE_URL')?.replace(/\/+$/, '') ??
      'https://api-seller.ozon.ru'
    );
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
