// Running app version, surfaced in the Settings footer.
//
// Injected at build time via VITE_APP_VERSION (frontend/Dockerfile builder ARG,
// set by the release workflow from the git tag). Unset in the Vite dev server
// and in plain local builds, so those fall back to "dev" — a non-release build
// never renders an official-looking version. The Makefile's dev/rebuild targets
// pass `dev-<short-sha>` so locally built/served frontends read e.g. `dev-1a2b3c`.
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev';
