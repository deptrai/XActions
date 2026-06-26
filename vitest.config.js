import { defineConfig } from 'vitest/config';

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
    exclude: ['node_modules', 'dist', 'archive'],
    reporters: ['verbose'],
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
