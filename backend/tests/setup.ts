import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll } from 'vitest';

process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret';
// A deterministic 32-byte key so crypto.service tests don't depend on the
// dev env. Value is base64(Buffer.alloc(32, 0xab)) — fine for tests, useless
// outside them.
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 0xab).toString('base64');

// Prisma auto-loads backend/.env, which points at the dev DB. We ignore that
// here and unconditionally pin to the test DB — the test suite must never
// touch development data (CLAUDE.md: "never run tests against the dev DB").
const explicitTestDb =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storyeditor:storyeditor@localhost:5432/storyeditor_test';
export const testDatabaseUrl = explicitTestDb;

process.env.DATABASE_URL = testDatabaseUrl;

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
});

export async function teardown(): Promise<void> {
  await prisma.$disconnect();
}

afterAll(async () => {
  await teardown();
});
