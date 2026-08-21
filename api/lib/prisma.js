import { PrismaClient } from '@prisma/client';

const globalForPrisma = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));

export const prisma = /** @type {import('@prisma/client').PrismaClient | undefined} */ (globalForPrisma.__prisma) ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

let isDisconnecting = false;

const disconnect = async (/** @type {string} */ signal) => {
  if (isDisconnecting) return;
  isDisconnecting = true;
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error(`❌ Prisma disconnect error (${signal}):`, (err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  }
};

process.on('beforeExit', async () => {
  await disconnect('beforeExit');
});

export default prisma;
