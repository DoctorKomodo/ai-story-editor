import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'], // backend is "type": "commonjs"; prod stays `node dist/index.js`
  platform: 'node',
  target: 'node24', // matches node:24-alpine
  sourcemap: true, // prod stack traces map back to source
  clean: true,
  minify: false, // keep require() calls greppable — the CI inline assertion depends on it
  // story-editor-shared is pure Zod/TS — inline it so the prod artifact has no
  // `story-editor-shared` runtime specifier. Everything else in node_modules
  // (Prisma, argon2, pg, express, …) stays external by tsup's default.
  noExternal: ['story-editor-shared'],
});
