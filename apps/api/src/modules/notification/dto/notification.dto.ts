import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
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
    description: '关联订单的当前 ERP 状态（派生）；不是通知自身的投递状态',
  })
  orderStatus!: string | null;
  @ApiPropertyOptional({ nullable: true, type: NotificationGoodsDto })
  goods!: NotificationGoodsDto | null;
  @ApiProperty({ description: '当前用户是否已读（2026-10-26）' })
  isRead!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    enum: NOTIFICATION_STATUSES,
    description: '当前用户自己最近一次推送的状态；未订阅为 null',
  })
  deliveryStatus!: string | null;
}

export class NotificationConditionFieldDto {
  @ApiProperty({ example: 'storeId' }) key!: string;
  @ApiProperty({ example: '店铺' }) label!: string;
}

export class NotificationEventCatalogItemDto {
  @ApiProperty({ example: 'ORDER_INTERCEPTION_REQUIRED' }) type!: string;
  @ApiProperty({ example: '需要拦截' }) label!: string;
  @ApiProperty({ enum: ['INFO', 'WARN', 'HIGH'] }) level!: string;
  @ApiProperty({ type: [NotificationConditionFieldDto] })
  conditionFields!: NotificationConditionFieldDto[];
}

export class NotificationDeleteResultDto {
  @ApiProperty({ example: true }) deleted!: boolean;
}

export class NotificationUnreadCountDto {
  @ApiProperty({ example: 2 }) unreadTotal!: number;
}

export class NotificationMarkReadResultDto {
  @ApiProperty({ example: 0 }) unreadTotal!: number;
}

export class NotificationRetryResultDto {
  @ApiProperty({ example: 1, description: '重新入队的失败投递数' }) retried!: number;
}

// ---------------------------------------------------------------------------
// 订阅 / 通道绑定（2026-10-26）
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_CHANNELS = ['FEISHU_DM', 'FEISHU_GROUP'] as const;

export class UpsertSubscriptionRequestDto {
  @ApiProperty({ enum: SUBSCRIPTION_CHANNELS, example: 'FEISHU_DM' })
  @IsIn(SUBSCRIPTION_CHANNELS)
  channel!: 'FEISHU_DM' | 'FEISHU_GROUP';

  @ApiProperty({ enum: NOTIFICATION_TYPES, example: 'ORDER_INTERCEPTION_REQUIRED' })
  @IsIn(NOTIFICATION_TYPES)
  eventType!: string;

  @ApiPropertyOptional({
    description:
      'AND 组合的过滤条件：键为事件可过滤字段（storeId / warehouseCode / skuCode / level），值为候选集合。空对象 = 该事件全收',
    example: { level: ['HIGH'] },
  })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, string[]>;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateSubscriptionRequestDto {
  @ApiPropertyOptional({
    description: '覆盖过滤条件（AND 组合）',
    example: { storeId: ['<uuid>'] },
  })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, string[]>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class NotificationSubscriptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ enum: SUBSCRIPTION_CHANNELS }) channel!: string;
  @ApiProperty({ enum: NOTIFICATION_TYPES }) eventType!: string;
  @ApiProperty({ example: { level: ['HIGH'] } }) conditions!: Record<string, string[]>;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ type: Date }) updatedAt!: Date;
}

export class UpsertChannelBindingRequestDto {
  @ApiProperty({ enum: ['FEISHU_DM', 'EMAIL'], example: 'FEISHU_DM' })
  @IsIn(['FEISHU_DM', 'EMAIL'])
  channel!: 'FEISHU_DM' | 'EMAIL';

  @ApiProperty({
    example: 'ou_73a01ef75e7500c9e59abd9271a4129f',
    description: '飞书 open_id（按应用隔离，换应用需重新绑定）或邮箱地址',
  })
  @IsString()
  @MaxLength(255)
  address!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UserChannelBindingDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ enum: ['FEISHU_DM', 'EMAIL'] }) channel!: string;
  @ApiProperty() address!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ nullable: true, type: Date }) verifiedAt!: Date | null;
  @ApiProperty({ type: Date }) updatedAt!: Date;
}
