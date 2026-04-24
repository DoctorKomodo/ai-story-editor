import path from 'node:path';
import { defineConfig } from 'vitest/config';

// L-series live Venice tests. NEVER part of CI or the default backend suite.
// Run explicitly via `npm run test:live` from the backend directory after
// provisioning backend/.env.live. Kept isolated so the default suite stays
// deterministic and offline.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/live/**/*.test.ts'],
    // No globalSetup — live tests don't touch the DB.
    // No setupFiles from the main suite either; live tests are standalone.
    pool: 'forks',
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
