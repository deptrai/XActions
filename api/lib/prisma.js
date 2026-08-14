import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

let isDisconnecting = false;

const disconnect = async (signal) => {
  if (isDisconnecting) return;
  isDisconnecting = true;
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error(`❌ Prisma disconnect error (${signal}):`, err.message);
    process.exitCode = 1;
  }
};

process.on('beforeExit', async () => {
  await disconnect('beforeExit');
});

export default prisma;
