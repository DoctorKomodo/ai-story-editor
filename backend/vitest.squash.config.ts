import path from 'node:path';
import { defineConfig } from 'vitest/config';

// story-editor-9wk.9 migration-squash harness. NEVER part of CI or the
// default backend suite (tests/migrations/** is excluded in vitest.config.ts).
// Run explicitly via `npm run test:migration-squash` with the compose stack
// up. No globalSetup / setupFiles: the harness owns its own scratch database
// and must not reset the worker-template DBs or construct the app Prisma
// client.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/migrations/**/*.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    sequence: { concurrent: false },
    // Fixture load + two `prisma migrate deploy` runs are slow; give the
    // whole pipeline room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // vitest 4 defaults this to true — without the override, an include glob
    // that matches nothing exits 0 and the harness silently stops proving
    // anything (same defence as the main vitest.config.ts).
    passWithNoTests: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
