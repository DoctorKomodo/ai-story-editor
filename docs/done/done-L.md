> Source of truth: `TASKS.md`. Closed [L]-series tasks archived here on 2026-04-28 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

## 🔌 L — Live Venice testing (opt-in, dev-only)

Optional live-API path for validating V-series work against a real Venice endpoint without exercising the frontend. **Never part of the default test suite.** A spending-capped API key is supplied out-of-band via `backend/.env.live`, which is gitignored. Live tests and the probe CLI are the only consumers — production code paths remain BYOK-only.

- [x] **[L1]** `backend/.env.live.example` (committed) documents `LIVE_VENICE_API_KEY`, `LIVE_VENICE_ENDPOINT`, `LIVE_VENICE_MODEL` with comments about spending caps and scope. `backend/.env.live` added to `.gitignore`. No production code path reads these variables — grep proves it.
  - verify: `bash -c 'grep -q "^backend/.env.live$" .gitignore && test -f backend/.env.live.example && ! grep -rn "LIVE_VENICE_" backend/src'`

- [x] **[L2]** Vitest config split: `backend/tests/live/**` excluded from the default run (`vitest.config.ts` `test.exclude`); a second config `vitest.live.config.ts` includes **only** that folder. `package.json` adds `"test:live": "vitest --run --config vitest.live.config.ts"`. Default `npm run test:backend` continues to exclude live tests.
  - verify: `cd backend && { npm run test:backend -- --run 2>&1 || true; } | grep -v 'tests/live/' | grep 'Test Files' > /dev/null && test -f vitest.live.config.ts`

- [x] **[L3]** `backend/scripts/venice-probe.ts` — `ts-node` CLI that loads `backend/.env.live`, exposes `--models`, `--prompt <text>`, `--stream`, `--model <id>`. Uses the same OpenAI-compatible client construction as [V17]. Prints response body (and SSE chunks when `--stream`). Exits 1 on Venice error, 2 on missing `.env.live`. `package.json` adds `"venice:probe": "ts-node scripts/venice-probe.ts"`.
  - verify: `cd backend && npm run venice:probe -- --help | grep -q 'venice-probe'`

- [x] **[L4]** Live integration tests in `backend/tests/live/venice.live.test.ts`: (1) `GET /v1/models` returns a non-empty text-model list; (2) non-streaming completion returns a non-empty string; (3) streaming completion yields ≥1 SSE delta then a `[DONE]`. Each uses `it.skipIf(!process.env.LIVE_VENICE_API_KEY)` so the file is safe with no key present. **Not** added to CI.
  - verify: `cd backend && test -f tests/live/venice.live.test.ts && npm run test:live -- --run 2>&1 | grep -qE '(skipped|passed)'`

---
