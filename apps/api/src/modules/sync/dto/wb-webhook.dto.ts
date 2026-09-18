import { ApiProperty } from '@nestjs/swagger';

/**
 * WB webhook 订阅管理接口的响应 DTO（2026-09-18）。
 *
 * 这三个端点的视图原本是 Service 里的普通 TS interface，无法被
 * `ApiOkEnvelope` 引用，导致 openapi.json 里 2xx 完全没有 content
 * （`pnpm check:openapi` 报 "declares no content at all"）。补上 DTO 类后
 * 生成的 api-client 才有真实响应类型，与其它端点一致。
 *
 * 不含 secret 本体（AGENTS.md §29）。
 */
export class WbWebhookSubscriptionDto {
  @ApiProperty({ description: '平台侧是否存在本店铺的订阅' })
  subscribed!: boolean;

  @ApiProperty({ nullable: true, type: String })
  webhookId!: string | null;

  @ApiProperty({ description: 'WCIES 注册到 WB 的回调 URL' })
  url!: string;

  @ApiProperty({ nullable: true, type: Boolean })
  enabled!: boolean | null;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      required: ['scope', 'event'],
      properties: { scope: { type: 'string' }, event: { type: 'string' } },
    },
    description: '已订阅的平台事件（scope/event 对）',
  })
  subscriptions!: { scope: string; event: string }[];

  @ApiProperty({ description: '本地是否已保存用于验证入站推送的 WEBHOOK secret' })
  secretConfigured!: boolean;
}

export class WbWebhookUnsubscribeResultDto {
  @ApiProperty({ description: '平台侧删除的订阅数量' })
  deleted!: number;

  @ApiProperty()
  url!: string;
}
