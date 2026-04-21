import { PrismaClient } from '@prisma/client';
import { afterAll } from 'vitest';

process.env.NODE_ENV ??= 'test';

// Prisma auto-loads backend/.env, which points at the dev DB. We ignore that
// here and unconditionally pin to the test DB — the test suite must never
// touch development data (CLAUDE.md: "never run tests against the dev DB").
const explicitTestDb =
  process.env.TEST_DATABASE_URL ?? 'postgresql://storyeditor:storyeditor@localhost:5432/storyeditor_test';
export const testDatabaseUrl = explicitTestDb;

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
