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
  },
});
