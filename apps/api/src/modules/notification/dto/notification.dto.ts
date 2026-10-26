import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
} from '../enums/notification.constants';

export class NotificationListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NOTIFICATION_TYPES })
  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: string;

  @ApiPropertyOptional({ enum: NOTIFICATION_CHANNELS })
  @IsOptional()
  @IsIn(NOTIFICATION_CHANNELS)
  channel?: string;

  @ApiPropertyOptional({ enum: NOTIFICATION_STATUSES })
  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() referenceId?: string;
}

export class NotificationGoodsDto {
  @ApiProperty({
    enum: [
      'CREATED',
      'ASSIGNED',
      'LOCATING',
      'INTERCEPTED',
      'RETURNED_TO_STOCK',
      'FAILED',
      'CLOSED',
    ],
    description: '拦截任务当前状态（货物在哪由它 + 库位决定）',
  })
  interceptionStatus!: string;

  @ApiProperty({
    type: [String],
    example: ['ZG-01-E01-1'],
    description: '实物当初从哪些库位拣出（拣货后未回归库位，通常就在拣货区/拣货车）',
  })
  pickBinCodes!: string[];

  @ApiPropertyOptional({
    nullable: true,
    example: 'ZG-01-A01-1',
    description: '拦截回库后落入的库位（未回库为 null）',
  })
  targetBinCode!: string | null;

  @ApiProperty({ type: [String], example: [], description: '已装入的包裹号（未装包为空）' })
  packageNos!: string[];
}

export class NotificationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NOTIFICATION_TYPES }) type!: string;
  @ApiProperty({ enum: NOTIFICATION_CHANNELS }) channel!: string;
  @ApiProperty({ example: 'ORDER_INTERCEPTION' }) referenceType!: string;
  @ApiProperty() referenceId!: string;
  @ApiProperty({ nullable: true }) recipient!: string | null;
  @ApiProperty({ example: '需要拦截：订单 ORD00000001' }) title!: string;
  @ApiProperty({ type: String }) content!: string;
  @ApiProperty({ enum: NOTIFICATION_STATUSES }) status!: string;
  @ApiProperty() attemptCount!: number;
  @ApiProperty({ nullable: true }) lastError!: string | null;
  @ApiProperty({ nullable: true, type: Date }) sentAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) failedAt!: Date | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiPropertyOptional({
    nullable: true,
    example: 'CANCELLED',
    description:
      '关联订单的当前 ERP 状态（派生，不落库）。仅 ORDER / ORDER_INTERCEPTION 类型有值；不是通知自身的投递状态',
  })
  orderStatus!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: NotificationGoodsDto,
    description:
      '拦截类通知的「实物现在在哪」：拦截进度 + 原拣货库位 / 回库目标库位 / 已装包裹。其它类型为 null',
  })
  goods!: NotificationGoodsDto | null;
}

export class RetryNotificationResultDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NOTIFICATION_STATUSES }) status!: string;
  @ApiProperty({ type: String }) message!: string;
}
