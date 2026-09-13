import Redis from 'ioredis';
import type { PrismaService } from '../../src/prisma/prisma.service';

const KEEP_TABLES = new Set(['plan_limits', '_prisma_migrations']);

/** Truncates every public table except reference data / migration history. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const tables = rows.map((row) => row.tablename).filter((name) => !KEEP_TABLES.has(name));
  if (tables.length === 0) {
    return;
  }
  const list = tables.map((name) => `"public"."${name}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/** FLUSHDB on the test Redis so rate-limit windows never leak between files. */
export async function flushRedis(redisUrl: string): Promise<void> {
  const client = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  try {
    await client.flushdb();
  } finally {
    await client.quit();
  }
}
