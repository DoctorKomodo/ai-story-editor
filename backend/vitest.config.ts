import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { isIntentionalLog } from './tests/intentional-logs';
import { TEST_WORKER_COUNT } from './tests/worker-db';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/live/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    // Fast-argon2 opt-in (see src/services/argon2.config.ts + .env.test.example).
    // Set here — not in a workflow env block — so local and CI runs get it
    // identically. argon2.config.test.ts fails the suite if this stops arriving.
    env: { TEST_FAST_ARGON2: '1' },
    // Per-worker template databases (tests/worker-db.ts): globalSetup
    // migrates one template DB, then clones it once per worker
    // (`storyeditor_test_w1..wN`); tests/setup.ts pins each worker's
    // DATABASE_URL to its clone via VITEST_POOL_ID before the Prisma client
    // is constructed. Files in different workers therefore never share a
    // database, and files in the SAME worker run sequentially against their
    // clone with per-file wipe hooks (tests/helpers/db.ts) — do NOT drop a
    // file's wipe hooks, and do NOT hand-serialize back to maxWorkers: 1.
    // The cap must equal the number of clones globalSetup creates, so it
    // lives in worker-db.ts, not here.
    maxWorkers: TEST_WORKER_COUNT,
    // Tests WITHIN a file stay serial: files assume exclusive DB state
    // between their own beforeEach/afterEach wipes, and that assumption
    // must hold regardless of worker count.
    sequence: { concurrent: false },
    // Fail if the run collected no tests at all — defence against config
    // drift (e.g. an `include` glob that silently matches nothing) or an
    // import-time failure that manifests as "0 tests per file" without an
    // obvious red flag. CI also asserts `numTotalTests > 0` on top of this.
    passWithNoTests: false,
    // Force the full default reporter so console output prints on every
    // invocation — `make test` then shows what CI shows. CI's CLI `--reporter`
    // flags still override this.
    reporters: ['default'],
    // Suppress by-design dev logs from error-path tests so output is readable.
    // Returns false ⇒ vitest drops the whole console block. Unmatched lines
    // still print, so unexpected errors stay visible. The logging still RUNS
    // (E12 leak test relies on it); this governs display only.
    onConsoleLog(log: string): boolean | void {
      if (isIntentionalLog(log)) return false;
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'story-editor-shared': path.resolve(__dirname, '../shared/src'),
    },
  },
});
