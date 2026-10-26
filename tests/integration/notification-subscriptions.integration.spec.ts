import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * 通知订阅 / 未读（2026-10-26）。
 *
 * 覆盖 HTTP 面：通道绑定、订阅 CRUD 与字段校验、未读数、单条已读、全部已读。
 * fan-out 与条件匹配在单测里覆盖（不在这里触发真实飞书投递）。
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3126';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
let db: Client;

interface Subscription {
  id: string;
  channel: string;
  eventType: string;
  conditions: Record<string, string[]>;
  enabled: boolean;
}

beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  api = spawnApiEntry('main.js', { PORT: '3126', REDIS_URL: 'redis://localhost:6379/13' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
}, 180_000);

afterAll(async () => {
  await db.query(
    `DELETE FROM notification_subscriptions WHERE event_type LIKE 'ORDER_INTERCEPTION%'
       AND user_id IN (SELECT id FROM users WHERE username IN ('admin'))`,
  );
  await db.query(
    `DELETE FROM user_channel_bindings WHERE channel = 'FEISHU_DM'
       AND user_id IN (SELECT id FROM users WHERE username IN ('admin'))`,
  );
  await db.query(`DELETE FROM notifications WHERE title LIKE $1`, [`${PREFIX}%`]);
  await api.stop();
  await db.end();
});

describe('通知订阅与未读', () => {
  it('绑定飞书 open_id 后可回读；订阅 CRUD 生效', async () => {
    const bind = await client.post(`/api/v1/notifications/channels`, {
      channel: 'FEISHU_DM',
      address: 'ou_73a01ef75e7500c9e59abd9271a4129f',
      enabled: true,
    });
    expect(bind.status, JSON.stringify(bind.body.error ?? {})).toBe(200);
    const channels = await client.get<Array<{ channel: string; address: string }>>(
      '/api/v1/notifications/channels',
    );
    expect(channels.body.data.find((row) => row.channel === 'FEISHU_DM')?.address).toBe(
      'ou_73a01ef75e7500c9e59abd9271a4129f',
    );

    const created = await client.post<Subscription>('/api/v1/notifications/subscriptions', {
      channel: 'FEISHU_DM',
      eventType: 'ORDER_INTERCEPTION_FAILED',
      conditions: { level: ['HIGH'], warehouseCode: ['ZG-01'] },
    });
    expect(created.status, JSON.stringify(created.body.error ?? {})).toBe(200);
    expect(created.body.data.conditions).toEqual({ level: ['HIGH'], warehouseCode: ['ZG-01'] });

    const list = await client.get<Subscription[]>('/api/v1/notifications/subscriptions');
    expect(list.body.data.some((row) => row.id === created.body.data.id)).toBe(true);

    const disabled = await client.patch<Subscription>(
      `/api/v1/notifications/subscriptions/${created.body.data.id}`,
      { enabled: false },
    );
    expect(disabled.body.data.enabled).toBe(false);

    await client.del(`/api/v1/notifications/subscriptions/${created.body.data.id}`);
    const after = await client.get<Subscription[]>('/api/v1/notifications/subscriptions');
    expect(after.body.data.some((row) => row.id === created.body.data.id)).toBe(false);
  });

  it('订阅字段校验：未知事件 / 不支持的过滤字段被拒（422）', async () => {
    const badEvent = await client.post('/api/v1/notifications/subscriptions', {
      channel: 'FEISHU_DM',
      eventType: 'NOT_A_REAL_EVENT',
    });
    expect(badEvent.status).toBe(400);

    const badField = await client.post('/api/v1/notifications/subscriptions', {
      channel: 'FEISHU_DM',
      eventType: 'ORDER_INTERCEPTION_REQUIRED',
      conditions: { notAField: ['x'] },
    });
    expect(badField.status).toBe(422);
    expect(badField.body.error?.code).toBe('NOTIFICATION_INVALID_INPUT');
  });

  it('未读数 → 单条已读 → 全部已读', async () => {
    const before = await client.get<{ unreadTotal: number }>('/api/v1/notifications/unread-count');
    const baseUnread = before.body.data.unreadTotal;

    // 直接造一条事件（不发推送）：未读 = 事件存在但没有 read 行。
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO notifications (type, channel, reference_type, reference_id, title, content, status)
       VALUES ('ORDER_INTERCEPTION_REQUIRED', 'SYSTEM', 'ORDER', $1, $2, 'test', 'SENT')
       RETURNING id`,
      [randomUUID(), `${PREFIX} 未读测试`],
    );
    const notificationId = inserted.rows[0]!.id;

    const list = await client.get<Array<{ id: string; isRead: boolean }>>(
      `/api/v1/notifications?pageSize=50`,
    );
    const row = list.body.data.find((item) => item.id === notificationId);
    expect(row?.isRead).toBe(false);
    expect((list.body as { unreadTotal?: number }).unreadTotal).toBe(baseUnread + 1);

    const read = await client.post<{ unreadTotal: number }>(
      `/api/v1/notifications/${notificationId}/read`,
      {},
    );
    expect(read.body.data.unreadTotal).toBe(baseUnread);

    const unread = await client.get<{ unreadTotal: number }>('/api/v1/notifications/unread-count');
    expect(unread.body.data.unreadTotal).toBe(baseUnread);

    const all = await client.post<{ unreadTotal: number }>('/api/v1/notifications/read-all', {});
    expect(all.body.data.unreadTotal).toBe(0);
    expect(
      (await client.get<{ unreadTotal: number }>('/api/v1/notifications/unread-count')).body.data
        .unreadTotal,
    ).toBe(0);
  });
});
