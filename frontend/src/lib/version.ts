// `__APP_VERSION__` is injected at build time by Vite (and under Vitest) from
// frontend/package.json — see vite.config.ts / vitest.config.ts `define`.
declare const __APP_VERSION__: string;

/** App version for display on the auth pages, e.g. "v0.1.0". */
export const APP_VERSION = `v${__APP_VERSION__}`;
