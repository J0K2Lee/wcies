import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { WebhookIngestService } from '../services/webhook.service';
import {
  OzonWebhookService,
  OzonWebhookSubscriptionView,
  OzonWebhookUnsubscribeResult,
} from '../services/ozon-webhook.service';
import {
  OzonWebhookSubscriptionDto,
  OzonWebhookUnsubscribeResultDto,
} from '../dto/ozon-webhook.dto';
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

/**
 * OZON push-notification 订阅管理（认证 API）。订阅模型是 Client-Id 级
 * URL 列表：服务层只按本店回调 URL 精确匹配操作，不影响同账户下其他
 * 订阅。订阅/退订是真实平台写操作（AGENTS.md §92），仅由操作员在
 * 店铺页显式触发。
 */
@ApiTags('stores')
@Controller('stores/:storeId/webhooks/ozon')
export class OzonWebhookManageController {
  constructor(private readonly webhookService: OzonWebhookService) {}

  @Get('subscription')
  @ApiOperation({ summary: '查询店铺的 OZON 事件订阅状态（只读，不调平台写端点）' })
  @ApiOkEnvelope(OzonWebhookSubscriptionDto)
  async status(
    @Param('storeId') storeId: string,
  ): Promise<{ success: true; data: OzonWebhookSubscriptionView }> {
    return ok(await this.webhookService.getStatus(storeId));
  }

  @Post('subscription')
  @ApiOperation({
    summary: '订阅/对齐 OZON 事件（本店 URL 设为 WCIES 推荐事件集，真实平台写操作）',
  })
  @ApiOkEnvelope(OzonWebhookSubscriptionDto)
  async subscribe(
    @Param('storeId') storeId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: OzonWebhookSubscriptionView }> {
    return ok(await this.webhookService.subscribe(storeId, operator));
  }

  @Delete('subscription')
  @ApiOperation({ summary: '退订 OZON 事件（按本店回调 URL 精确匹配删除，真实平台写操作）' })
  @ApiOkEnvelope(OzonWebhookUnsubscribeResultDto)
  async unsubscribe(
    @Param('storeId') storeId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: OzonWebhookUnsubscribeResult }> {
    return ok(await this.webhookService.unsubscribe(storeId, operator));
  }
}
