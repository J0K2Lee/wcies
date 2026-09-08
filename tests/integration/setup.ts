/**
 * Integration test bootstrap.
 *
 * 1. Loads the repo root .env when present (same source as `pnpm seed:dev`,
 *    so ADMIN_PASSWORD matches the seeded admin).
 * 2. Fills docker-compose defaults for anything still missing so
 *    `pnpm test:integration` works right after `docker compose up -d`.
 * 3. Forces the DATABASE_URL onto the dedicated `wcies_test` database -
 *    integration suites must never touch the dev business database again
 *    (Sprint 3 task §88-§89). The database itself is created/migrated by
 *    `scripts/ensure-test-db.ts` before vitest starts.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

const DEFAULTS: Record<string, string> = {
  PORT: '3101',
  DATABASE_URL: 'postgresql://wcies:wcies_dev_password@localhost:5432/wcies_test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'integration-test-jwt-secret-0123456789abcdef',
  JWT_EXPIRES_IN: '1h',
  CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'wcies_minio_dev',
  S3_SECRET_KEY: 'wcies_minio_dev_secret',
  S3_BUCKET: 'wcies',
  S3_FORCE_PATH_STYLE: 'true',
  CORS_ORIGIN: 'http://localhost:5173',
  ADMIN_USERNAME: 'admin',
  ADMIN_EMAIL: 'admin@wcies.local',
  ADMIN_PASSWORD: 'integration-test-password',
};

for (const [key, value] of Object.entries(DEFAULTS)) {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

// Test isolation override: whatever .env says, the spawned API processes get
// the test database (opt out only via TEST_KEEP_DATABASE_URL=1).
if (process.env.TEST_KEEP_DATABASE_URL !== '1') {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = '/wcies_test';
  process.env.DATABASE_URL = url.toString();
}
