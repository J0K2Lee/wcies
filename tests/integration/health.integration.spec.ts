import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieHeader, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';

/**
 * Health + database connection integration checks (Sprint 0 task §36).
 * Spawns the compiled API (dist/main.js) against docker compose services.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3101';

beforeAll(async () => {
  // Dedicated Redis DB: login rate-limit counters must not leak between specs.
  api = spawnApiEntry('main.js', { PORT: '3101', REDIS_URL: 'redis://localhost:6379/1' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
});

afterAll(async () => {
  await api.stop();
});

describe('GET /health/live', () => {
  it('returns ok without touching dependencies', async () => {
    const response = await fetch(`${BASE}/health/live`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
  });
});

describe('GET /health/ready', () => {
  it('reports PostgreSQL and Redis up', async () => {
    const response = await fetch(`${BASE}/health/ready`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { status: string; checks: { postgres: string; redis: string } };
    };
    expect(body.data.checks.postgres).toBe('up');
    expect(body.data.checks.redis).toBe('up');
  });
});

describe('request id propagation', () => {
  it('echoes X-Request-ID when provided and generates one when missing', async () => {
    const withId = await fetch(`${BASE}/health/live`, {
      headers: { 'X-Request-ID': 'integration-test-id-1' },
    });
    expect(withId.headers.get('x-request-id')).toBe('integration-test-id-1');

    const withoutId = await fetch(`${BASE}/health/live`);
    const generated = withoutId.headers.get('x-request-id');
    expect(generated).not.toBeNull();
    expect(generated).not.toBe('integration-test-id-1');
  });

  it('includes requestId in error responses', async () => {
    const response = await fetch(`${BASE}/api/v1/auth/me`);
    expect(response.status).toBe(401);
    const body = (await response.json()) as {
      success: boolean;
      error: { code: string };
      requestId: string;
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_UNAUTHORIZED');
    expect(body.requestId.length).toBeGreaterThan(0);
  });
});

describe('auth flow against PostgreSQL', () => {
  it('logs in with the seeded admin (Argon2 + JWT cookie) and reads /auth/me', async () => {
    const login = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernameOrEmail: process.env.ADMIN_USERNAME ?? 'admin',
        password: process.env.ADMIN_PASSWORD ?? 'integration-test-password',
      }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.getSetCookie?.() ?? [];
    const sessionCookie = setCookie.find((c) => c.startsWith('wcies_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');

    const me = await fetch(`${BASE}/api/v1/auth/me`, {
      headers: { Cookie: cookieHeader(login) },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { success: boolean; data: { username: string } };
    expect(meBody.data.username).toBe(process.env.ADMIN_USERNAME ?? 'admin');
  });
});
