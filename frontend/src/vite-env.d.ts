/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * App version baked in at build time from the git tag by the release
   * workflow (e.g. "0.2.0"). Unset in the Vite dev server and in local builds
   * that don't inject it — consumers fall back to "dev" (see lib/appVersion).
   */
  readonly VITE_APP_VERSION?: string;
  /**
   * Optional backend API origin. Empty/unset means origin-relative `/api`
   * (nginx reverse-proxies to the backend); set to call a separate API origin.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
