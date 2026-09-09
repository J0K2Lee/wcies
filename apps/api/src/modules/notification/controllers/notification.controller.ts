import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok, okPage } from '../../../common/dto/api-response';
import { ApiOkEnvelope, ApiOkPagedEnvelope } from '../../../common/swagger/api-envelope';
import { NotificationService } from '../services/notification.service';
import {
  NotificationDto,
  NotificationListQueryDto,
  RetryNotificationResultDto,
} from '../dto/notification.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: '通知列表（分页，按类型/通道/状态过滤）' })
  @ApiOkPagedEnvelope(NotificationDto)
  async list(@Query() query: NotificationListQueryDto) {
    const result = await this.notificationService.list(query, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return okPage<NotificationDto>(result.items, result.meta);
  }

  @Get(':id')
  @ApiOperation({ summary: '通知详情' })
  @ApiOkEnvelope(NotificationDto)
  async get(@Param('id') id: string) {
    return ok<NotificationDto>(await this.notificationService.getById(id));
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重试失败的 FEISHU 通知投递' })
  @ApiOkEnvelope(RetryNotificationResultDto)
  async retry(@Param('id') id: string) {
    const dto = await this.notificationService.retry(id);
    return ok({ id: dto.id, status: dto.status, message: '已重新入队' });
  }
}
