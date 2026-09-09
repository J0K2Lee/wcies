import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { WebhookIngestService } from '../services/webhook.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/**
 * OZON webhook HTTP entry (Sprint 5 task §26/§28).
 *
 * The URL (including the per-store code) is what the seller configures in
 * the OZON cabinet. Contract verified against the official docs: JSON body
 * with a `message_type` discriminator; OZON expects `{"result": true}` and
 * retries non-2xx (docs/integrations/ozon.md). The handler does NOTHING but
 * validate the shape, persist the raw event and enqueue - no order
 * creation, no stock locking, no platform API calls.
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
      required: ['result'],
      properties: { result: { type: 'boolean' } },
    },
  })
  async receive(
    @Param('storeCode') storeCode: string,
    @Body() payload: unknown,
  ): Promise<{ result: boolean }> {
    try {
      await this.ingestService.ingestOzon(storeCode, payload);
      // ACCEPTED / DUPLICATE / REJECTED all answer result:true - redelivery
      // must not loop forever (already stored, or not trusted).
      return { result: true };
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
      return { result: true };
    }
  }
}
