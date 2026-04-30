import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/live/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    maxWorkers: 1,
    sequence: { concurrent: false },
    // Fail if the run collected no tests at all — defence against config
    // drift (e.g. an `include` glob that silently matches nothing) or an
    // import-time failure that manifests as "0 tests per file" without an
    // obvious red flag. CI also asserts `numTotalTests > 0` on top of this.
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
