import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../auth/decorators/public.decorator';
import { WebhookIngestService } from '../services/webhook.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import {
  YANDEX_WEBHOOK_DEFAULT_ALLOWLIST,
  extractClientIp,
  isIpAllowed,
} from './yandex-webhook-ip';

/** Yandex notification acknowledgement (docs §4): {version, name, time}. */
export interface YandexWebhookAck {
  version: string;
  name: string;
  time: string;
}

const YANDEX_ACK_VERSION = '1.0.0';
const YANDEX_ACK_NAME = 'WCIES';

/**
 * Yandex Market webhook HTTP entry (2026-09-18, docs/integrations/yandex.md
 * §4; plan §P3).
 *
 * The URL (including the per-store code) is what the seller configures in
 * the Market cabinet («API 通知»). Contract:
 * - PING must answer HTTP 200 `{version, name, time}` within 1 SECOND -
 *   answered inline, no persistence, no queue (the strict budget leaves no
 *   room for anything else);
 * - regular notifications get the same ack shape within 10 seconds; the
 *   handler does NOTHING but verify the source, persist the raw event and
 *   enqueue - no order creation, no stock locking, no platform API calls
 *   (AGENTS.md §47);
 * - invalid notifications answer 400 (the platform stops retrying those);
 * - no signature exists - the source IP must sit in the platform ranges
 *   (default the official three; override via YANDEX_WEBHOOK_IP_ALLOWLIST,
 *    disable only for local tunnel tests via YANDEX_WEBHOOK_DISABLE_IP_ALLOWLIST).
 *
 * 14 unreachable days disconnect the integration - webhook health must stay
 * observable; the polling scheduler remains the catch-up backbone either way.
 */
@ApiTags('webhooks')
@Public()
@Controller('webhooks/yandex/stores/:storeCode')
export class YandexWebhookController {
  constructor(
    private readonly ingestService: WebhookIngestService,
    private readonly config: ConfigService,
    private readonly logger: AppLoggerService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Yandex Market API 通知入口（IP 白名单 + PING 秒回 + raw event 入队）' })
  @ApiOkResponse({
    description: 'Yandex 约定的确认格式（非 WCIES envelope）',
    schema: {
      type: 'object',
      required: ['version', 'name', 'time'],
      properties: {
        version: { type: 'string', example: '1.0.0' },
        name: { type: 'string', example: 'WCIES' },
        time: { type: 'string', format: 'date-time', example: '2026-09-18T15:30:00Z' },
      },
    },
  })
  async receive(
    @Param('storeCode') storeCode: string,
    @Body() payload: unknown,
    @Req() request: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } },
  ): Promise<YandexWebhookAck> {
    // `time` stamps when processing started, so capture it before any work.
    const startedAt = new Date();

    if (!this.ipAllowed(request)) {
      this.logger.warn('yandex webhook rejected: source ip outside allowlist', {
        module: 'sync',
        storeCode,
      });
      throw new ForbiddenException('source address not allowed');
    }

    // Connectivity probe: answer within the 1-second budget, nothing else.
    if (isPing(payload)) {
      return buildAck(startedAt);
    }

    try {
      await this.ingestService.ingestYandex(storeCode, payload);
      // ACCEPTED / DUPLICATE / REJECTED all answer with the success ack -
      // redelivery must not loop forever (already stored, or not trusted).
      return buildAck(startedAt);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String(error.code) === 'PLATFORM_BAD_RESPONSE'
      ) {
        // Invalid notification: 400 tells the platform to stop retrying.
        this.logger.warn('yandex webhook payload malformed', { module: 'sync', storeCode });
        throw new BadRequestException('malformed notification');
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String(error.code) === 'STORE_NOT_FOUND'
      ) {
        throw error;
      }
      // Unknown transient failures: still 200 - Yandex retries on non-400
      // failures and the polling catch-up covers any lost event.
      this.logger.error(
        `yandex webhook ingest failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        { module: 'sync', storeCode },
      );
      return buildAck(startedAt);
    }
  }

  private ipAllowed(request: {
    headers: Record<string, unknown>;
    socket?: { remoteAddress?: string };
  }): boolean {
    if (this.config.get<string>('YANDEX_WEBHOOK_DISABLE_IP_ALLOWLIST') === 'true') {
      return true; // local tunnel testing only - never in production
    }
    const configured = this.config.get<string>('YANDEX_WEBHOOK_IP_ALLOWLIST');
    const allowlist =
      configured !== undefined && configured !== ''
        ? configured
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '')
        : [...YANDEX_WEBHOOK_DEFAULT_ALLOWLIST];
    const ip = extractClientIp(request);
    if (ip === null) {
      return false;
    }
    return isIpAllowed(ip, allowlist);
  }
}

function isPing(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as Record<string, unknown>).notificationType === 'PING'
  );
}

function buildAck(startedAt: Date): YandexWebhookAck {
  return {
    version: YANDEX_ACK_VERSION,
    name: YANDEX_ACK_NAME,
    time: startedAt.toISOString(),
  };
}
