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
}

export class RetryNotificationResultDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NOTIFICATION_STATUSES }) status!: string;
  @ApiProperty({ type: String }) message!: string;
}
