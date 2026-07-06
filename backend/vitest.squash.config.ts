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
    // Fail if the run collected no tests at all — defence against config
    // drift (e.g. an `include` glob that silently matches nothing). Mirrors
    // the main vitest.config.ts guard; the plan's empty-include RED
    // checkpoint (harness wired but no test file yet) relies on this.
    passWithNoTests: false,
  },
});
