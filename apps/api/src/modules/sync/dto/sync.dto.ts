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
  @ApiProperty({
    nullable: true,
    type: Object,
    description: '最近一次类目树同步（Sprint 8.5，手动；只展示不告警）',
  })
  lastCategoryTreeSync!: { status: string; finishedAt: Date | null } | null;
  @ApiProperty({
    nullable: true,
    type: Object,
    description: '最近一次商品属性增强同步（Sprint 8.5，手动；只展示不告警）',
  })
  lastProductEnrichmentSync!: { status: string; finishedAt: Date | null } | null;
  @ApiProperty({ description: '连续失败次数（成功即清零）' }) consecutiveFailures!: number;
  @ApiProperty({ nullable: true, type: String }) activeJobId!: string | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: '订单自动轮询的生效间隔（分钟）：店铺自定义优先，否则系统默认；null = 系统级关闭',
  })
  orderSyncIntervalMinutes!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      '商品链接自动轮询的生效间隔（分钟）：店铺自定义优先，否则系统默认；null = 系统级关闭',
  })
  listingSyncIntervalMinutes!: number | null;
}

/** Webhook 订阅体检结果（2026-10-27）：抽屉「立即体检」与巡检共用。 */
export class WebhookHealthDto {
  @ApiProperty() storeId!: string;
  @ApiProperty({ example: 'ON-003' }) storeCode!: string;
  @ApiProperty({ example: 'OZON' }) platform!: string;
  @ApiProperty({
    enum: ['OK', 'NOT_SUBSCRIBED', 'PAUSED', 'UNHEALTHY', 'UNSUPPORTED', 'UNKNOWN'],
  })
  state!: string;
  @ApiProperty({ description: '人可读原因（进异常详情与通知正文）' })
  reason!: string;
  @ApiProperty({ description: '本次体检完成时间（ISO，UTC）' })
  checkedAt!: string;
  @ApiProperty({
    nullable: true,
    type: Object,
    description: 'OZON 平台探测明细（isActive + errors），其它平台为 null',
  })
  check!: { isActive: boolean; errors: Array<{ type: string; description: string }> } | null;
  @ApiProperty({
    nullable: true,
    type: Object,
    description:
      '本机公网自检（把平台的探测请求打回自己的回调地址）：ok=true 表示入口现在可用；' +
      '平台 check.errors 是滚动窗口，修复后仍可能残留旧错误',
  })
  selfCheck!: { ok: boolean; detail: string } | null;
  @ApiProperty({
    nullable: true,
    type: Object,
    description:
      '平台投递可用性（OZON 2026-11-07）：status GREEN/YELLOW/RED，YELLOW 起即预警；' +
      'problematicType 是平台记账的失败事件类型',
  })
  availability!: {
    status: string;
    disableReason: string | null;
    since: string | null;
    problematicType: string | null;
  } | null;
  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description: '最近一次收到该店任何推送（含 PING）；null = 从未收到',
  })
  lastEventAt!: string | null;
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
