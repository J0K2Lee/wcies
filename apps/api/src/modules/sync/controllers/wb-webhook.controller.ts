import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { ok } from '../../../common/dto/api-response';
import { ApiOkEnvelope } from '../../../common/swagger/api-envelope';
import { WebhookIngestService } from '../services/webhook.service';
import { WbWebhookSubscriptionDto, WbWebhookUnsubscribeResultDto } from '../dto/wb-webhook.dto';
import {
  WbWebhookService,
  WbWebhookSubscriptionView,
  WbWebhookUnsubscribeResult,
} from '../services/wb-webhook.service';

/**
 * WB webhook HTTP 入口（2026-09-18，docs verified）。
 *
 * 契约：JSON body = 事件投递信封（events[] 最多 100 个）；成功投递必须在
 * 10 秒内返回 HTTP 200（非 200 触发 10s→15min 递增重试，长期失败会被
 * WB 停用 webhook）。真实性验证 = Authorization 头 == 店铺 WEBHOOK 凭证
 * 中保存的 secret（时序安全比较）——不匹配回 401，让投递失败在 WB 的
 * delivery 日志里可见。处理器动作与 OZON 的 ITEM_CHANGED 一致：记录事实。
 *
 * URL 由 WbWebhookService.subscribe 通过 WB API 创建：
 *   {PUBLIC_BASE_URL}/api/v1/webhooks/wb/stores/{storeCode}
 */
@ApiTags('webhooks')
@Public()
@Controller('webhooks/wb/stores/:storeCode')
export class WbWebhookReceiverController {
  constructor(
    private readonly ingestService: WebhookIngestService,
    private readonly logger: AppLoggerService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'WB webhook 事件投递入口（secret 验证 + 逐事件落库 + 入队）' })
  @ApiOkResponse({
    description: '仅要求 HTTP 200；body 供排查用（非平台约定格式）',
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        status: { type: 'string', enum: ['ACCEPTED', 'DUPLICATE'] },
      },
    },
  })
  async receive(
    @Param('storeCode') storeCode: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() payload: unknown,
  ): Promise<{ ok: boolean; status: string }> {
    try {
      const status = await this.ingestService.ingestWb(storeCode, payload, authorization);
      if (status === 'REJECTED') {
        // Wrong/absent secret: 401 so the failure shows up in WB's delivery
        // log (WB retries, then drops - polling covers the data meanwhile).
        throw new UnauthorizedException('invalid webhook secret');
      }
      return { ok: true, status };
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String(error.code) === 'PLATFORM_BAD_RESPONSE'
      ) {
        // Malformed envelope: 400 (misconfiguration signal, not retry bait).
        this.logger.warn('wb webhook payload malformed', { module: 'sync', storeCode });
        throw new BadRequestException('malformed event envelope');
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String(error.code) === 'STORE_NOT_FOUND'
      ) {
        throw error;
      }
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Unknown transient failures: still 200 - WB retries on non-200 and
      // the idempotencyKey dedup makes redelivery safe (docs §Idempotency).
      this.logger.error(
        `wb webhook ingest failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        { module: 'sync', storeCode },
      );
      return { ok: true, status: 'ACCEPTED' };
    }
  }
}

/**
 * WB webhook 订阅管理（认证 API）。与 OZON/Yandex 在卖家后台配置不同，
 * WB 的订阅通过平台 API 创建/删除 —— 这里暴露对应的运维入口。
 */
@ApiTags('stores')
@Controller('stores/:storeId/webhooks/wb')
export class WbWebhookManageController {
  constructor(private readonly webhookService: WbWebhookService) {}

  @Get('subscription')
  @ApiOperation({ summary: '查询店铺的 WB webhook 订阅状态' })
  @ApiOkEnvelope(WbWebhookSubscriptionDto)
  async status(
    @Param('storeId') storeId: string,
  ): Promise<{ success: true; data: WbWebhookSubscriptionView }> {
    return ok(await this.webhookService.getStatus(storeId));
  }

  @Post('subscription')
  @ApiOperation({
    summary: '订阅 WB webhook（平台侧创建 + 一次性 secret 加密落库为 WEBHOOK 凭证）',
  })
  @ApiOkEnvelope(WbWebhookSubscriptionDto)
  async subscribe(
    @Param('storeId') storeId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: WbWebhookSubscriptionView }> {
    return ok(await this.webhookService.subscribe(storeId, operator));
  }

  @Delete('subscription')
  @ApiOperation({ summary: '退订 WB webhook（按回调 URL 精确匹配删除）' })
  @ApiOkEnvelope(WbWebhookUnsubscribeResultDto)
  async unsubscribe(
    @Param('storeId') storeId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: WbWebhookUnsubscribeResult }> {
    return ok(await this.webhookService.unsubscribe(storeId, operator));
  }
}
