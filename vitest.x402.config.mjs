import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

// Dedicated config for the live-server x402 integration suite. The file is
// excluded from the default vitest run because it needs `npm run dev` up.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    testTimeout: 30000,
    hookTimeout: 30000,
    retry: 0,
    include: ['tests/x402-integration.test.js'],
    reporters: ['verbose'],
    env: {
      TEST_API_URL: process.env.TEST_API_URL || 'http://localhost:3001',
    },
  },
});
