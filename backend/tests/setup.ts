import { PrismaClient } from '@prisma/client';
import { afterAll } from 'vitest';

process.env.NODE_ENV ??= 'test';

export const testDatabaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://storyeditor:storyeditor@localhost:5432/storyeditor_test';

process.env.DATABASE_URL = testDatabaseUrl;

export const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

export async function teardown(): Promise<void> {
  await prisma.$disconnect();
}

afterAll(async () => {
  await teardown();
});
