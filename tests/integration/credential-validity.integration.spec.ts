import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * API Key 有效期声明（2026-10-26 用户需求）：
 * 绑定凭证必须声明「到期日」或「长期」，否则拒绝；到期前 7 天起由扫描每天提醒
 * （扫描与投递在单测/通知集成里覆盖，这里只锁写入契约）。
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3127';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
let storeId = '';

interface CredentialResponse {
  id: string;
  expiresAt: string | null;
  validityDeclared: boolean;
  daysLeft: number | null;
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3127', REDIS_URL: 'redis://localhost:6379/14' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  const ozon = platforms.body.data.find((platform) => platform.code === 'OZON')?.id ?? '';
  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozon,
    storeCode: `${PREFIX}-CRED`,
    name: `${PREFIX} 凭证有效期店`,
  });
  storeId = store.body.data.id;
}, 180_000);

afterAll(async () => {
  await api.stop();
});

describe('API Key 有效期声明', () => {
  it('未声明有效期 → 422（必须选长期或到期日）', async () => {
    const response = await client.post('/api/v1/stores/' + storeId + '/credentials', {
      credentialType: 'MAIN_API',
      payload: { clientId: 'cid', apiKey: 'key' },
    });
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe('CREDENTIAL_VALIDITY_INVALID');
  });

  it('到期日必须是将来时间', async () => {
    const response = await client.post('/api/v1/stores/' + storeId + '/credentials', {
      credentialType: 'MAIN_API',
      payload: { clientId: 'cid', apiKey: 'key' },
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect(response.status).toBe(422);
  });

  it('长期有效与到期日不能同时给', async () => {
    const response = await client.post('/api/v1/stores/' + storeId + '/credentials', {
      credentialType: 'MAIN_API',
      payload: { clientId: 'cid', apiKey: 'key' },
      longTerm: true,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(response.status).toBe(422);
  });

  it('声明到期日后返回剩余天数；长期返回 null', async () => {
    const withDate = await client.post<CredentialResponse>(
      '/api/v1/stores/' + storeId + '/credentials',
      {
        credentialType: 'MAIN_API',
        payload: { clientId: 'cid', apiKey: 'key' },
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
    );
    expect([200, 201], JSON.stringify(withDate.body.error ?? {})).toContain(withDate.status);
    expect(withDate.body.data.validityDeclared).toBe(true);
    expect(withDate.body.data.daysLeft).toBe(30);

    // 换成长期（更新同一凭证）
    const longTerm = await client.patch<CredentialResponse>(
      `/api/v1/stores/${storeId}/credentials/${withDate.body.data.id}`,
      { credentialType: 'MAIN_API', payload: { clientId: 'cid', apiKey: 'key2' }, longTerm: true },
    );
    expect(longTerm.status, JSON.stringify(longTerm.body.error ?? {})).toBe(200);
    expect(longTerm.body.data.expiresAt).toBeNull();
    expect(longTerm.body.data.daysLeft).toBeNull();
    expect(longTerm.body.data.validityDeclared).toBe(true);
  });
});
