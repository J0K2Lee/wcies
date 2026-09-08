import { Injectable, Logger } from '@nestjs/common';

/**
 * Feishu webhook Provider (Sprint 4 task §49-§51) - the ONLY place that is
 * allowed to talk to Feishu. Business modules never call fetch(feishu...)
 * (AGENTS.md §52). The webhook URL comes from configuration; when it is not
 * configured the FEISHU channel simply stays inactive (no guessed URLs).
 */
@Injectable()
export class FeishuProvider {
  private readonly logger = new Logger(FeishuProvider.name);

  async sendText(webhookUrl: string, payload: { title: string; content: string }): Promise<void> {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: {
          text: `${payload.title}\n${payload.content}`,
        },
      }),
      // Keep the caller snappy; delivery failures surface as FAILED rows.
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`feishu webhook HTTP ${response.status}`);
    }
    const body = (await response.json().catch(() => null)) as {
      code?: number;
      msg?: string;
    } | null;
    if (body !== null && typeof body.code === 'number' && body.code !== 0) {
      throw new Error(`feishu webhook error ${body.code}: ${body.msg ?? ''}`);
    }
    this.logger.debug(`feishu notification delivered (${payload.title})`);
  }
}
