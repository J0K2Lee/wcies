import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieHeader, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';

/**
 * Object storage round trip (Sprint 0 task §19):
 * upload -> MinIO -> signed URL -> read back, via POST /api/v1/dev/storage-test.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3103';

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3103', REDIS_URL: 'redis://localhost:6379/3' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
});

afterAll(async () => {
  await api.stop();
});

describe('POST /api/v1/dev/storage-test', () => {
  it('uploads, signs and reads back a test object', async () => {
    const login = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernameOrEmail: process.env.ADMIN_USERNAME ?? 'admin',
        password: process.env.ADMIN_PASSWORD ?? 'integration-test-password',
      }),
    });
    expect(login.status).toBe(200);

    const response = await fetch(`${BASE}/api/v1/dev/storage-test`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(login) },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { objectKey: string; signedUrl: string; verified: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.objectKey).toMatch(/^dev\/storage-test-/);
    expect(body.data.verified).toBe(true);
  });
});
