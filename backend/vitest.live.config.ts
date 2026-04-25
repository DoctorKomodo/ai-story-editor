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
    // Real Venice round-trips can spike past the default 5s, especially the
    // streaming SSE test waiting for the first delta. Hook timeout matches so
    // beforeAll's client construction (which is fast, but inherits this scope)
    // doesn't impose its own tighter cap.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Venice's chat-completions endpoint occasionally returns 429
    // "The model is currently overloaded" or stalls for >30s — both transient
    // server-side conditions, not failures of the SDK wiring this suite is
    // here to verify. Retry each test up to 2 times before reporting failure.
    retry: 2,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
