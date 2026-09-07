import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieHeader, spawnApiEntry, waitForHttp, waitForOutput, ManagedProcess } from './helpers';

/**
 * BullMQ test-queue round trip (Sprint 0 task §16):
 * API -> POST /api/v1/dev/test-job -> Redis -> Worker -> structured log.
 */
let api: ManagedProcess;
let worker: ManagedProcess;
const BASE = 'http://localhost:3102';

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3102', REDIS_URL: 'redis://localhost:6379/2' });
  worker = spawnApiEntry('worker.js', { PORT: '3102', REDIS_URL: 'redis://localhost:6379/2' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
});

afterAll(async () => {
  await api.stop();
  await worker.stop();
});

describe('POST /api/v1/dev/test-job', () => {
  it('enqueues a job that the worker consumes (unique marker in logs)', async () => {
    const marker = `bullmq-it-${Date.now()}`;

    const login = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernameOrEmail: process.env.ADMIN_USERNAME ?? 'admin',
        password: process.env.ADMIN_PASSWORD ?? 'integration-test-password',
      }),
    });
    expect(login.status).toBe(200);

    const response = await fetch(`${BASE}/api/v1/dev/test-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(login) },
      body: JSON.stringify({ message: marker }),
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      success: boolean;
      data: { jobId: string; queue: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.queue).toBe('wcies.test');

    await waitForOutput(worker, new RegExp(marker), 30_000);
  });
});
