import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 飞书客户端（2026-10-26）：通知模块**唯一**允许访问飞书的出口（AGENTS §52）。
 *
 * 两条通道：
 * - 应用私聊：`POST /open-apis/im/v1/messages?receive_id_type=open_id`，需要
 *   企业自建应用（app_id/app_secret + 机器人能力 + `im:message:send_as_bot`）；
 * - 群机器人：自定义机器人 webhook，只能发到它所在的群。
 *
 * 凭证优先取系统配置（当前落在 .env 的 APP_ID/APP_SECRET，后续做成设置项），
 * 未配置时抛 `FeishuNotConfiguredError`，由投递层记录 FAILED，不影响业务事务。
 */
export class FeishuNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeishuNotConfiguredError';
  }
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

@Injectable()
export class FeishuProvider {
  private readonly logger = new Logger(FeishuProvider.name);
  private token: CachedToken | null = null;

  constructor(private readonly config: ConfigService) {}

  /** 私聊发卡片（按 open_id）。 */
  async sendCardToOpenId(openId: string, card: Record<string, unknown>): Promise<void> {
    await this.sendMessage(openId, card);
  }

  /** 群机器人发卡片（webhook）。 */
  async sendCardToWebhook(webhookUrl: string, card: Record<string, unknown>): Promise<void> {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'interactive', card }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`feishu webhook HTTP ${response.status}`);
    }
    const body = (await response.json().catch(() => null)) as {
      code?: number;
      msg?: string;
      StatusCode?: number;
      StatusMessage?: string;
    } | null;
    const code = body?.code ?? body?.StatusCode;
    if (typeof code === 'number' && code !== 0) {
      throw new Error(`feishu webhook error ${code}: ${body?.msg ?? body?.StatusMessage ?? ''}`);
    }
  }

  /** tenant_access_token（缓存到过期前 5 分钟）。 */
  private async tenantToken(): Promise<string> {
    const appId = this.config.get<string | null>('app.feishuAppId', { infer: true }) ?? null;
    const appSecret =
      this.config.get<string | null>('app.feishuAppSecret', { infer: true }) ?? null;
    if (appId === null || appId === '' || appSecret === null || appSecret === '') {
      throw new FeishuNotConfiguredError('飞书应用凭证未配置（APP_ID / APP_SECRET）');
    }
    const now = Date.now();
    if (this.token !== null && this.token.expiresAt > now) {
      return this.token.value;
    }
    const response = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    } | null;
    if (
      !response.ok ||
      body === null ||
      body.code !== 0 ||
      body.tenant_access_token === undefined
    ) {
      throw new Error(
        `feishu tenant_access_token failed: HTTP ${response.status} code=${String(body?.code)} ${body?.msg ?? ''}`,
      );
    }
    // expire 是剩余秒数（通常 7200），留 5 分钟余量。
    const ttlMs = Math.max(((body.expire ?? 7200) - 300) * 1000, 60_000);
    this.token = { value: body.tenant_access_token, expiresAt: now + ttlMs };
    return this.token.value;
  }

  private async sendMessage(openId: string, card: Record<string, unknown>): Promise<void> {
    const token = await this.tenantToken();
    const response = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receive_id: openId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      code?: number;
      msg?: string;
      data?: { message_id?: string };
    } | null;
    if (!response.ok || body === null || body.code !== 0) {
      throw new Error(
        `feishu send failed: HTTP ${response.status} code=${String(body?.code)} ${body?.msg ?? ''}`,
      );
    }
    this.logger.debug(`feishu dm delivered (${body.data?.message_id ?? 'no-id'})`);
  }
}
