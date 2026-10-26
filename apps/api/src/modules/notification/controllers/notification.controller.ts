import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok, okPage } from '../../../common/dto/api-response';
import {
  ApiOkArrayEnvelope,
  ApiOkEnvelope,
  ApiOkPagedEnvelope,
} from '../../../common/swagger/api-envelope';
import { CurrentOperator } from '../../../common/decorators/current-operator.decorator';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { NotificationService } from '../services/notification.service';
import {
  NotificationDeleteResultDto,
  NotificationDto,
  NotificationEventCatalogItemDto,
  NotificationListQueryDto,
  NotificationMarkReadResultDto,
  NotificationRetryResultDto,
  NotificationSubscriptionDto,
  NotificationUnreadCountDto,
  UpdateSubscriptionRequestDto,
  UpsertChannelBindingRequestDto,
  UpsertSubscriptionRequestDto,
  UserChannelBindingDto,
} from '../dto/notification.dto';
import { NOTIFICATION_EVENTS } from '../events/notification-events';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /** 订阅/绑定/已读是「我的」数据，必须登录（路由已由会话守卫保护）。 */
  private requireUserId(operator: OperatorContext): string {
    if (operator.userId === null) {
      throw new Error('notification endpoint requires an authenticated user');
    }
    return operator.userId;
  }

  @Get()
  @ApiOperation({ summary: '通知列表（分页；带当前用户未读标记与自己的投递状态）' })
  @ApiOkPagedEnvelope(NotificationDto)
  async list(
    @Query() query: NotificationListQueryDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{
    success: true;
    data: NotificationDto[];
    meta: { page: number; pageSize: number; total: number };
    unreadTotal: number;
  }> {
    const result = await this.notificationService.list(
      query,
      { page: query.page, pageSize: query.pageSize },
      operator.userId,
    );
    const page = okPage<NotificationDto>(result.items, result.meta);
    return { ...page, unreadTotal: result.unreadTotal };
  }

  @Get('unread-count')
  @ApiOperation({ summary: '当前用户未读通知数（铃铛红点）' })
  @ApiOkEnvelope(NotificationUnreadCountDto)
  async unreadCount(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: { unreadTotal: number } }> {
    return ok({ unreadTotal: await this.notificationService.unreadCount(operator.userId) });
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '把当前用户的全部通知标为已读' })
  @ApiOkEnvelope(NotificationMarkReadResultDto)
  async markAllRead(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: { marked: number; unreadTotal: number } }> {
    return ok(await this.notificationService.markAllRead(this.requireUserId(operator)));
  }

  @Get('event-catalog')
  @ApiOperation({
    summary: '可订阅的事件目录（类型、级别、可过滤字段）——订阅 UI 据此渲染',
  })
  @ApiOkArrayEnvelope(NotificationEventCatalogItemDto)
  async eventCatalog(): Promise<{
    success: true;
    data: NotificationEventCatalogItemDto[];
  }> {
    return ok(
      Object.values(NOTIFICATION_EVENTS).map((event) => ({
        type: event.type,
        label: event.label,
        level: event.level,
        conditionFields: event.conditionFields,
      })),
    );
  }

  @Get('subscriptions')
  @ApiOperation({ summary: '当前用户的通知订阅规则' })
  @ApiOkArrayEnvelope(NotificationSubscriptionDto)
  async listSubscriptions(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: NotificationSubscriptionDto[] }> {
    return ok(await this.notificationService.listSubscriptions(this.requireUserId(operator)));
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '新增订阅（用户 × 通道 × 事件 × 条件）' })
  @ApiOkEnvelope(NotificationSubscriptionDto)
  async createSubscription(
    @Body() dto: UpsertSubscriptionRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: NotificationSubscriptionDto }> {
    return ok(
      await this.notificationService.createSubscription({
        userId: this.requireUserId(operator),
        channel: dto.channel,
        eventType: dto.eventType,
        conditions: dto.conditions ?? {},
        enabled: dto.enabled ?? true,
      }),
    );
  }

  @Patch('subscriptions/:id')
  @ApiOperation({ summary: '修改订阅（条件 / 启停）' })
  @ApiOkEnvelope(NotificationSubscriptionDto)
  async updateSubscription(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: NotificationSubscriptionDto }> {
    return ok(
      await this.notificationService.updateSubscription(id, this.requireUserId(operator), {
        ...(dto.conditions === undefined ? {} : { conditions: dto.conditions }),
        ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
      }),
    );
  }

  @Delete('subscriptions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除订阅' })
  @ApiOkEnvelope(NotificationDeleteResultDto)
  async deleteSubscription(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: { deleted: boolean } }> {
    await this.notificationService.deleteSubscription(id, this.requireUserId(operator));
    return ok({ deleted: true });
  }

  @Get('channels')
  @ApiOperation({ summary: '当前用户的通道绑定（飞书 open_id / 邮箱）' })
  @ApiOkArrayEnvelope(UserChannelBindingDto)
  async listBindings(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: UserChannelBindingDto[] }> {
    return ok(await this.notificationService.listBindings(this.requireUserId(operator)));
  }

  @Post('channels')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '绑定/更新通道地址（飞书 open_id / 邮箱）' })
  @ApiOkEnvelope(UserChannelBindingDto)
  async upsertBinding(
    @Body() dto: UpsertChannelBindingRequestDto,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: UserChannelBindingDto }> {
    return ok(
      await this.notificationService.upsertBinding({
        userId: this.requireUserId(operator),
        channel: dto.channel,
        address: dto.address,
        enabled: dto.enabled ?? true,
      }),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '通知详情' })
  @ApiOkEnvelope(NotificationDto)
  async get(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: NotificationDto }> {
    return ok(await this.notificationService.getById(id, operator.userId));
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '标记该通知为已读（当前用户）' })
  @ApiOkEnvelope(NotificationMarkReadResultDto)
  async markRead(
    @Param('id') id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<{ success: true; data: { unreadTotal: number } }> {
    return ok(await this.notificationService.markRead(id, this.requireUserId(operator)));
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重试该通知下失败的推送' })
  @ApiOkEnvelope(NotificationRetryResultDto)
  async retry(@Param('id') id: string): Promise<{ success: true; data: { retried: number } }> {
    return ok(await this.notificationService.retry(id));
  }
}
