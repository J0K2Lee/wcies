import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { YandexClient, YANDEX_DEFAULT_OPTIONS } from './yandex.client';

/**
 * Builds YandexClient instances from validated env config. YANDEX_API_BASE_URL
 * exists so integration tests can point the client at a local mock server
 * instead of the real platform.
 */
@Injectable()
export class YandexClientFactory {
  constructor(private readonly config: ConfigService) {}

  create(): YandexClient {
    return new YandexClient({
      baseUrl: this.baseUrl(),
      timeoutMs: numberEnv(this.config, 'YANDEX_TIMEOUT_MS', YANDEX_DEFAULT_OPTIONS.timeoutMs),
      maxRetries: numberEnv(this.config, 'YANDEX_MAX_RETRIES', YANDEX_DEFAULT_OPTIONS.maxRetries),
      perStoreMinIntervalMs: numberEnv(
        this.config,
        'YANDEX_MIN_REQUEST_INTERVAL_MS',
        YANDEX_DEFAULT_OPTIONS.perStoreMinIntervalMs,
      ),
      maxConcurrency: numberEnv(
        this.config,
        'YANDEX_MAX_CONCURRENCY',
        YANDEX_DEFAULT_OPTIONS.maxConcurrency,
      ),
    });
  }

  baseUrl(): string {
    const configured = this.config.get<string>('YANDEX_API_BASE_URL')?.replace(/\/+$/, '');
    if (configured !== undefined && configured !== '') {
      return configured;
    }
    // Safety guard: automated tests must never reach the real platform.
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return 'http://127.0.0.1:9/yandex-not-configured';
    }
    return 'https://api.partner.market.yandex.ru';
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
