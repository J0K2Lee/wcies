import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { WebhookIngestService } from '../services/webhook.service';
import { buildPushAck, OzonPushAck } from '../../integration/ozon/ozon.mapper';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/**
 * OZON webhook HTTP entry (Sprint 5 task §26/§28).
 *
 * The URL (including the per-store code) is what the seller configures in
 * the OZON cabinet. Contract: JSON body with a `message_type` discriminator;
 * a successful delivery MUST answer HTTP 200 with `{version, name, time}` -
 * the legacy `{result: true}` body is rejected by the cabinet's address check
 * with WRONG_RESULT_TIME_FIELD (verified 2026-09-14, docs/integrations/ozon.md
 * §6.4). The handler does NOTHING but validate the shape, persist the raw
 * event and enqueue - no order creation, no stock locking, no platform API
 * calls.
 */
@ApiTags('webhooks')
@Public()
@Controller('webhooks/ozon/stores/:storeCode')
export class OzonWebhookController {
  constructor(
    private readonly ingestService: WebhookIngestService,
    private readonly logger: AppLoggerService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'OZON push notification 入口（保存 raw event 后立即返回）' })
  @ApiOkResponse({
    description: 'OZON 约定的确认格式（非 WCIES envelope）',
    schema: {
      type: 'object',
      required: ['version', 'name', 'time'],
      properties: {
        version: { type: 'string', example: '2.0' },
        name: { type: 'string', example: 'WCIES' },
        time: {
          type: 'string',
          format: 'date-time',
          example: '2026-09-14T15:30:00Z',
          description: '开始处理该通知的时间（UTC）',
        },
      },
    },
  })
  async receive(
    @Param('storeCode') storeCode: string,
    @Body() payload: unknown,
  ): Promise<OzonPushAck> {
    // `time` in the ack means "when processing started" (spec), so stamp it
    // before doing any work.
    const startedAt = new Date();
    try {
      await this.ingestService.ingestOzon(storeCode, payload);
      // ACCEPTED / DUPLICATE / REJECTED all answer with the success ack -
      // redelivery must not loop forever (already stored, or not trusted).
      return buildPushAck(startedAt);
    } catch (error: unknown) {
      // Malformed payloads (PLATFORM_BAD_RESPONSE) and unknown stores get a
      // 4xx so misconfiguration surfaces in the OZON cabinet health check.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String(error.code) === 'PLATFORM_BAD_RESPONSE'
      ) {
        this.logger.warn('ozon webhook payload malformed', { module: 'sync', storeCode });
        throw error;
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String(error.code) === 'STORE_NOT_FOUND'
      ) {
        throw error;
      }
      // Unknown transient failures: still 200 - OZON retries aggressively
      // and the polling catch-up covers any lost event (task §30).
      this.logger.error(
        `ozon webhook ingest failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        { module: 'sync', storeCode },
      );
      return buildPushAck(startedAt);
    }
  }
}
