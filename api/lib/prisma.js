import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

const disconnect = async (signal) => {
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error(`❌ Prisma disconnect error (${signal}):`, err.message);
    process.exitCode = 1;
  }
};

process.on('beforeExit', () => disconnect('beforeExit'));
process.on('SIGINT', () => disconnect('SIGINT').finally(() => process.exit(0)));
process.on('SIGTERM', () => disconnect('SIGTERM').finally(() => process.exit(0)));

export default prisma;
