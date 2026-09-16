import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.spec.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    env: {
      NODE_ENV: 'test',
    },
    // Spec files share API ports (3101-3122) and Redis DBs by design; the
    // suite is only deterministic when files run one at a time. This was
    // previously a manual CLI flag (Sprint 9 baseline note) - now baked in
    // so plain `pnpm test:integration` matches the documented invocation.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
