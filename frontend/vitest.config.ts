import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    css: false,
    // Fail if the run collected no tests at all — defence against config
    // drift or a peer-dep regression that makes every test file collect
    // 0 tests (see the @testing-library/dom incident). CI also asserts
    // `numTotalTests > 0` on top of this.
    passWithNoTests: false,
  },
});
