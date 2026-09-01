import 'dotenv/config';
import { defineConfig } from 'vitest/config';

const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5434/xactions_test?schema=public';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    fileParallelism: false,
    retry: 0,
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules', 'dist', 'archive', 'tests/e2e/video*.e2e.test.js'],
    reporters: ['verbose'],
    env: {
      DATABASE_URL: testDatabaseUrl,
      DATABASE_URL_TEST: testDatabaseUrl,
    },
    sequence: {
      shuffle: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'archive/',
        'scripts/',
        '*.config.js',
      ],
    },
  },
});
