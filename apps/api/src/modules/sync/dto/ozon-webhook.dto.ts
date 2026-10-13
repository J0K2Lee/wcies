import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * OZON 事件订阅管理接口的响应 DTO（2026-10-09）。
 *
 * 与 WbWebhookSubscriptionDto 同理：Service 的视图 interface 无法被
 * `ApiOkEnvelope` 引用，openapi.json 里 2xx 会没有 content
 * （`pnpm check:openapi` 报 "declares no content at all"）。
 */
export class OzonWebhookSubscriptionDto {
  @ApiProperty({ description: '本店回调 URL 是否已在 OZON 侧订阅' })
  subscribed!: boolean;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'OZON 侧订阅 ID' })
  subscriptionId!: number | null;

  @ApiProperty({ description: '本店回调 URL（配置到 OZON 的地址）' })
  url!: string;

  @ApiPropertyOptional({
    nullable: true,
    type: Boolean,
    description: '订阅是否启用（平台自动暂停后为 false）',
  })
  enabled!: boolean | null;

  @ApiProperty({ type: [String], description: '该订阅当前的事件类型（平台侧事实）' })
  types!: string[];

  @ApiProperty({ type: [String], description: 'WCIES 推荐订阅的事件类型' })
  expectedTypes!: string[];

  @ApiProperty({ description: '同一 Client-Id 下其他订阅 URL 的数量' })
  otherUrlCount!: number;
}

export class OzonWebhookUnsubscribeResultDto {
  @ApiProperty({ description: '平台侧删除的订阅数量' })
  deleted!: number;

  @ApiProperty() url!: string;
}
