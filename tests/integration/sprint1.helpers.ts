import { cookieHeader } from './helpers';

/**
 * Sprint 1 integration-test HTTP client: cookie-authenticated fetch wrapper
 * with typed envelope unpacking.
 */
/** Response envelope: either success+data or the unified error shape. */
export interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string; details: Record<string, unknown> };
}

export class ApiClient {
  private cookies = '';

  constructor(private readonly base: string) {}

  async login(username?: string, password?: string): Promise<void> {
    const response = await fetch(`${this.base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernameOrEmail: username ?? process.env.ADMIN_USERNAME ?? 'admin',
        password: password ?? process.env.ADMIN_PASSWORD ?? 'integration-test-password',
      }),
    });
    if (response.status !== 200) {
      throw new Error(`login failed: HTTP ${response.status}`);
    }
    this.cookies = cookieHeader(response);
  }

  async get<T>(path: string): Promise<{ status: number; body: Envelope<T> }> {
    return this.request<T>('GET', path);
  }

  async post<T>(
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; body: Envelope<T> }> {
    return this.request<T>('POST', path, body, extraHeaders);
  }

  async patch<T>(path: string, body?: unknown): Promise<{ status: number; body: Envelope<T> }> {
    return this.request<T>('PATCH', path, body);
  }

  async put<T>(path: string, body?: unknown): Promise<{ status: number; body: Envelope<T> }> {
    return this.request<T>('PUT', path, body);
  }

  async del<T>(path: string): Promise<{ status: number; body: Envelope<T> }> {
    return this.request<T>('DELETE', path);
  }

  async upload<T>(
    path: string,
    file: { name: string; type: string; buffer: Buffer } | null,
  ): Promise<{ status: number; body: Envelope<T> }> {
    const form = new FormData();
    if (file !== null) {
      form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.type }), file.name);
    }
    const response = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { Cookie: this.cookies },
      body: form,
    });
    return {
      status: response.status,
      body: (await response.json()) as Envelope<T>,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; body: Envelope<T> }> {
    const headers: Record<string, string> = { Cookie: this.cookies, ...extraHeaders };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as Envelope<T>,
    };
  }
}

/** Error envelope for asserting domain error codes. */
export interface ApiErrorEnvelope {
  success: false;
  error: { code: string; message: string; details: Record<string, unknown> };
  requestId: string;
}

/** Unique-per-call prefix so parallel spec files never collide in the dev DB. */
export function runPrefix(): string {
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `IT${Date.now().toString(36).slice(-6).toUpperCase()}${random}`;
}
