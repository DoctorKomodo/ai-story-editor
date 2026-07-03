// Per-worker test-database scheme, shared by vitest.config.ts (worker cap),
// globalSetup.ts (clone creation), and setup.ts (per-worker DATABASE_URL).
//
// globalSetup migrates one TEMPLATE database (`storyeditor_test`), then
// creates `TEST_WORKER_COUNT` clones of it (`storyeditor_test_w1..wN`).
// Each vitest worker runs against its own clone, selected by
// `VITEST_POOL_ID` (1..maxWorkers), so files in different workers never
// share a database. Files in the SAME worker share a clone sequentially —
// per-file wipe hooks (tests/helpers/db.ts) keep that safe.

/**
 * Vitest worker cap = number of database clones created per run.
 * Measured on a 4-CPU container: 4 workers ≈ 38s wall; 8 workers gave no
 * further speedup and oversubscription pushed the E12 seed-subprocess test
 * past its timeout. Re-measure before raising this.
 */
export const TEST_WORKER_COUNT = 4;

/**
 * The template database URL. Migrations run against this; workers never
 * connect to it directly (a live connection would block `CREATE DATABASE
 * ... TEMPLATE`).
 */
export const TEMPLATE_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://storyeditor:storyeditor@localhost:5432/storyeditor_test';

export function templateDatabaseName(): string {
  return new URL(TEMPLATE_DATABASE_URL).pathname.slice(1);
}

export function workerDatabaseName(poolId: string): string {
  return `${templateDatabaseName()}_w${poolId}`;
}

export function workerDatabaseUrl(poolId: string): string {
  const url = new URL(TEMPLATE_DATABASE_URL);
  url.pathname = `/${workerDatabaseName(poolId)}`;
  return url.toString();
}
