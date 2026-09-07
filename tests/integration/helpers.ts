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
