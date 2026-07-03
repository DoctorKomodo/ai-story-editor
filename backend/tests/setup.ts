import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll } from 'vitest';
import { TEST_WORKER_COUNT, workerDatabaseUrl } from './worker-db';

process.env.NODE_ENV ??= 'test';

// Prisma auto-loads backend/.env, which points at the dev DB. We ignore that
// here and unconditionally pin to the test DB — the test suite must never
// touch development data (CLAUDE.md: "never run tests against the dev DB").
// Each worker gets its OWN clone of the migrated template (see
// tests/worker-db.ts), selected by VITEST_POOL_ID, and DATABASE_URL is pinned
// before any test file can construct the app's Prisma client.
const poolId = process.env.VITEST_POOL_ID ?? '1';
if (Number(poolId) > TEST_WORKER_COUNT) {
  throw new Error(
    `VITEST_POOL_ID=${poolId} exceeds TEST_WORKER_COUNT=${TEST_WORKER_COUNT} — ` +
      'globalSetup only created that many database clones. Raise TEST_WORKER_COUNT ' +
      'in tests/worker-db.ts instead of overriding maxWorkers on the CLI.',
  );
}
export const testDatabaseUrl = workerDatabaseUrl(poolId);

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
