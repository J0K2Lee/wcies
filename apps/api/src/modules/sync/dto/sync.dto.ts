import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { RAW_EVENT_STATUSES, SYNC_JOB_STATUSES, SYNC_TYPES } from '../sync.constants';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class TriggerSyncRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  storeId!: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class SyncJobDto {
  @ApiProperty() id!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty({ example: 'OZON-A' }) storeCode!: string;
  @ApiProperty({ example: 'OZON A店' }) storeName!: string;
  @ApiProperty({ example: 'OZON' }) platformCode!: string;
  @ApiProperty({ enum: SYNC_TYPES }) syncType!: string;
  @ApiProperty({ enum: SYNC_JOB_STATUSES }) status!: string;
  @ApiProperty({ enum: ['MANUAL', 'SCHEDULED', 'WEBHOOK', 'RETRY'] }) triggerType!: string;
  @ApiProperty({ nullable: true, type: Date }) startedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) finishedAt!: Date | null;
  @ApiProperty() successCount!: number;
  @ApiProperty() failedCount!: number;
  @ApiProperty() skippedCount!: number;
  @ApiProperty() retryCount!: number;
  @ApiProperty({ nullable: true, type: Object, description: '适配器游标（Opaque）' })
  cursorBefore!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: Object, description: '适配器游标（Opaque）' })
  cursorAfter!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
  @ApiProperty({ type: Date }) createdAt!: Date;
  @ApiProperty({ example: 4200, description: '运行时长（毫秒），未完成为 null' })
  durationMs!: number | null;
}

export class SyncJobListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() storeId?: string;
  @ApiPropertyOptional({ enum: SYNC_TYPES }) @IsOptional() @IsIn(SYNC_TYPES) syncType?: string;
  @ApiPropertyOptional({ enum: SYNC_JOB_STATUSES })
  @IsOptional()
  @IsIn(SYNC_JOB_STATUSES)
  status?: string;
}

export class StoreSyncOverviewDto {
  @ApiProperty() storeId!: string;
  @ApiProperty({ example: 'OZON-A' }) storeCode!: string;
  @ApiProperty({ example: 'OZON' }) platformCode!: string;
  @ApiProperty({ nullable: true, type: Object, description: '凭证验证元数据（不含密钥）' })
  credential!: {
    credentialId: string | null;
    configured: boolean;
    lastValidatedAt: Date | null;
    lastValidationStatus: string | null;
    lastValidationError: string | null;
  } | null;
  @ApiProperty({ nullable: true, type: Object }) lastOrderSync!: {
    status: string;
    finishedAt: Date | null;
  } | null;
  @ApiProperty({ nullable: true, type: Object }) lastListingSync!: {
    status: string;
    finishedAt: Date | null;
  } | null;
  @ApiProperty({ description: '连续失败次数（成功即清零）' }) consecutiveFailures!: number;
  @ApiProperty({ nullable: true, type: String }) activeJobId!: string | null;
}

export class RawEventDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'OZON' }) platform!: string;
  @ApiProperty() storeId!: string;
  @ApiProperty({ example: 'NEW_POSTING' }) eventType!: string;
  @ApiProperty({ nullable: true, type: String }) externalEventId!: string | null;
  @ApiProperty({ type: Object }) payload!: Record<string, unknown>;
  @ApiProperty() payloadHash!: string;
  @ApiProperty({ enum: RAW_EVENT_STATUSES }) status!: string;
  @ApiProperty({ type: Date }) receivedAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) processedAt!: Date | null;
  @ApiProperty({ nullable: true, type: String }) errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
}

export class RawEventListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() storeId?: string;
  @ApiPropertyOptional({ enum: RAW_EVENT_STATUSES })
  @IsOptional()
  @IsIn(RAW_EVENT_STATUSES)
  status?: string;
}
