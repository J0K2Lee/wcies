import { spawn, ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

export interface ManagedProcess {
  child: ChildProcess;
  output: string;
  stop(): Promise<void>;
}

/**
 * Spawns a compiled API entry (dist/main.js or dist/worker.js) with the
 * current environment. Output is accumulated for log-based assertions.
 */
export function spawnApiEntry(
  entry: 'main.js' | 'worker.js',
  extraEnv: Record<string, string> = {},
): ManagedProcess {
  // Strip vitest-injected flags (NODE_OPTIONS etc.) - the compiled entries
  // must run as plain node processes.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    if (key === 'NODE_OPTIONS' || key.startsWith('VITEST')) {
      continue;
    }
    env[key] = value;
  }
  const child = spawn(process.execPath, [resolve(ROOT, 'apps/api/dist', entry)], {
    cwd: resolve(ROOT, 'apps/api'),
    env: { ...env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  return {
    child,
    get output() {
      return output;
    },
    stop: async () => {
      if (child.exitCode !== null) {
        return;
      }
      await new Promise<void>((resolveStop) => {
        child.once('exit', () => resolveStop());
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }
        }, 8000).unref();
      });
    },
  };
}

export async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = undefined;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`waitForHttp(${url}) timed out: ${String(lastError)}`);
}

export async function waitForOutput(
  proc: ManagedProcess,
  pattern: RegExp,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(proc.output)) {
      return;
    }
    if (proc.child.exitCode !== null) {
      throw new Error(
        `process exited early (${proc.child.exitCode}). Output:\n${proc.output.slice(-2000)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `waitForOutput(${String(pattern)}) timed out. Output:\n${proc.output.slice(-2000)}`,
  );
}

/** Cookies from a Set-Cookie header, as a cookie request header value. */
export function cookieHeader(response: Response): string {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((line) => line.split(';')[0]).join('; ');
}

import { randomUUID } from 'node:crypto';

/**
 * 仓库绑定平台仓库（2026-09-17 模型，master-data.md §7）的测试便捷调用：
 * 每次调用生成唯一的平台仓库 ID（唯一键 store_id + platform_warehouse_id）。
 * 返回绑定 id，供解绑/断言使用。
 */
export async function bindPlatformWarehouse(
  client: {
    post: (path: string, body?: unknown) => Promise<{ body: { data?: { id: string } } }>;
  },
  storeId: string,
  warehouseId: string,
  fulfillmentMode = 'OZON_RFBS',
): Promise<{ id: string; platformWarehouseId: string }> {
  const platformWarehouseId = `pw-${randomUUID().slice(0, 12)}`;
  const res = await client.post(`/api/v1/warehouses/${warehouseId}/platform-bindings`, {
    storeId,
    platformWarehouseId,
    fulfillmentMode,
  });
  return { id: res.body.data?.id ?? '', platformWarehouseId };
}
