# Quality assessment — Inkwell (2026-07-02)

**Provenance:** synthesized from four parallel audit passes (backend, frontend,
encryption/session, tests/infra) over the codebase as of `main` @ the merge base
of PR #150. The five highest-leverage fixes were implemented and merged in
PR #150 (branch `claude/app-quality-assessment-l2s7ak`, 2026-07-02). Everything
else is tracked in bd — this document is the durable record of the findings and
their disposition, so the reasoning survives outside the session transcript.

## Status ledger

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | Client-side data-loss edges (no unload flush, fire-and-forget switch flush, deploy/expiry bounce) | **Fixed** — PR #150 (story-editor-tyh): IndexedDB drafts, restore banner, keepalive unload flush |
| 2 | Last-write-wins chapter PATCH; mid-stream disconnect discards billed assistant message | **Partly fixed** — PR #150 added `expectedUpdatedAt` precondition + 409 conflict banner. Disconnect-discard residual: `story-editor-jj3`. Conflict-banner navigation UX deferred: `story-editor-wdp` |
| 3 | Backup import silently deletes all stories before restore; 120s single-transaction ceiling | Open — `story-editor-50k` (P2) |
| 4 | ChatTab/SceneTab ~330-line duplicates with two live bugs | **Fixed** — PR #150 (story-editor-cqu): shared `ChatSceneTab`, both bugs erased |
| 5 | Venice call/streaming pipeline hand-assembled ×3 (~250 lines, SDK casts) | **Fixed** — PR #150 (story-editor-z8s): `venice-stream.service.ts` |
| 6 | Declared layering absent; services import types from route files; settings model duplicated | Open — `story-editor-o9o` (P3). The 440-line chat send handler was partly relieved by item 5's extraction |
| 7 | Ordered-child routers (chapters/characters/outline) triplicated | Open — `story-editor-co0` (P3); consider folding into the `story-editor-9wk` drafts epic |
| 8 | Express `Request` as crypto-context carrier; no non-HTTP path to a DEK | Open — `story-editor-0uu` (P2) |
| 9 | Three process-local stores; `--scale backend=2` silently breaks | Open — `story-editor-mak` (P3, minimal boot-guard remedy) |
| 10 | Two competing error systems; domain errors surface as 500s | **Fixed** — PR #150 (story-editor-j73): `HttpError` + central mapping |
| 11 | E2E never runs automatically while docs claim PR-gating | Docs fixed in PR #150 (story-editor-4ow); gating decision open — `story-editor-7ns` |
| 12 | Test suite serial + production-cost argon2; helpers copy-pasted ×38/×58 | Open — `story-editor-k5o` (P2), plan in progress |
| 13 | Editor typing latency scales with chapter length | Open — `story-editor-tzk` (P3) |
| 14 | Load-bearing doc drift (encryption.md, naming table, .env.example) | **Fixed** — PR #150 (story-editor-4ow) |
| 15 | Dead code with teeth (useScenes, Editor.tsx, SceneComposer, api.ts strands) | Open — `story-editor-4d5` (P3); importer-absence re-verified 2026-07-02 |
| 16 | Encrypted-field plumbing: string-key tax, lossy-backup gap, unsound tx cast | Open — `story-editor-046` (P2, round-trip test), `story-editor-f8w` (P4, typo-proofing), tx cast noted on `story-editor-50k` |
| 17 | Papercuts: composer clears before send outcome; settings fields silently unsaved; unbounded export; 403-vs-500 drift; Ask-AI wrong tab | Composer clear **fixed** in PR #150 (story-editor-cqu). Open: `story-editor-756`, `story-editor-1xt`, `story-editor-dat`; ownership-layering covered by pre-existing `story-editor-z7g` |

---

## The assessment (as delivered)

**Overall verdict:** this is a disciplined codebase, well above typical for its size (~510 TS files). The hard things were done right: the encrypt-on-write/decrypt-on-read repo boundary holds everywhere (export/import included), the shared Zod schemas are genuinely the single wire-contract source of truth, ownership is re-scoped at every Prisma query, DEK rewrap flows are atomic, dependencies are current, type-escape density is near zero, and CI is unusually thorough. The weaknesses are real but they're mostly *structural costs and drift*, not sloppiness — and they cluster into three themes: **data-loss edges in a writing app**, **copy-paste orchestration that has already started diverging**, and **a single-process design with no marked boundaries**.

### Tier 1 — product-critical fragility (fix first)

**1. Users can lose prose, and there's no client-side safety net.** The failure modes stack: the autosave debounce is 4s with no `beforeunload`/`pagehide` flush anywhere in the frontend (closing the tab loses up to 4s of typing); the chapter-switch flush is fire-and-forget with a comment admitting "the typed text is gone either way" (`frontend/src/hooks/useAutosave.ts:110-123`); and because DEKs live only in process memory, **every backend deploy, a 7-day idle expiry, or session-cap eviction bounces the user to /login mid-edit and discards the failed flush**. For a writing tool this is the sharpest edge in the app, and it's fixable entirely client-side (persist dirty TipTap JSON to IndexedDB, replay after re-login) without touching the crypto model.

**2. Chapter saves are last-write-wins with no recovery path.** The PATCH carries no version/`updatedAt` precondition (`backend/src/routes/chapters.routes.ts:188-218`), so two tabs silently clobber each other — and since bodies are stored as ciphertext, there is no diffable history to recover from after the fact. Same family: a mid-stream disconnect discards the entire (already-billed) assistant message (`chat.routes.ts:614-632`).

**3. Backup import is a silent full-account replace.** `import.service.ts:20` deletes every story before restoring — importing an old backup destroys everything written since, atomically and irreversibly, with the entire safety burden on frontend confirmation UX. It also runs row-by-row inside one transaction with a 120s ceiling, so large libraries will eventually hit the timeout.

**4. ChatTab/SceneTab are ~330-line near-duplicates with two live bugs from divergence.** SceneTab catches send errors; ChatTab doesn't, so every failed chat send is an unhandled rejection that also skips the first-turn auto-title (`ChatTab.tsx:127` vs `SceneTab.tsx:133-145`). And SceneTab never forwards the attached selection, so an attachment shown in the composer chip is silently dropped on send. This is the clearest example of the codebase's main disease: shared machinery exists (hooks, TranscriptView), but the orchestration shell was copy-pasted and is where bugs now accumulate.

### Tier 2 — architectural debt that compounds with every feature

**5. The Venice call/streaming pipeline is hand-assembled three times.** The identical ~15-step sequence (fetch models → hydrate settings → build prompt → build params → stream → forward rate-limit headers → SSE error frames) appears in `ai.routes.ts`, `chat.routes.ts`, and `chapters.routes.ts` — ~250 duplicated lines, byte-identical in places, already divergent in others (the citation latch). Each call site also casts through `as unknown as` at the OpenAI SDK boundary, erasing type safety exactly where a SDK major bump would bite. A single `streamVeniceCompletion()` service is the highest-leverage refactor in the repo.

**6. The declared layering doesn't exist.** `controllers/` contains only a `.gitkeep`; `chat.routes.ts` is a 665-line file whose send handler is ~440 lines of numbered phases — a service pipeline living in a route. Services also import types *from route files* (`venice-call.service.ts:3` imports `UserSettings` from `user-settings.routes.ts`) — inverted dependencies, with the settings domain model trapped in a route and its defaults/clamp logic hand-duplicated a third time in the frontend (`useUserSettings.ts`), synced only by comments, despite `shared/` existing for exactly this.

**7. The three ordered-child routers (chapters/characters/outline) are one file copy-pasted three times** — the P2002 retry loop, reorder validation, cross-checks, and the two-phase negative-parking reorder transaction all exist in triplicate. The next ordered entity becomes a fourth copy.

**8. The Express `Request` object is the crypto-context carrier.** The repo layer literally imports Express types; every service that touches plaintext takes `req`. Any future entrypoint that isn't a live HTTP request — background jobs, queued exports, WebSockets, CLI tooling — has no legitimate way to obtain a DEK. The crypto decision ("DEK exists only during a session") got conflated with a plumbing decision ("DEK is addressable only via `req`"); an explicit `CryptoContext { userId, dek }` would preserve the former and drop the latter. This is the single most expensive deferred refactor.

**9. Three in-memory stores hard-wire the app to exactly one process, and nothing marks the boundary.** Sessions/DEKs, rate-limit counters, and the models cache are all process-local Maps. That's a legitimate choice for self-hosting — but `docker compose up --scale backend=2` doesn't error, it produces nondeterministic random logouts, which is a miserable trap for exactly the operator audience this project targets. At minimum this needs a boot-time guard or compose warning; there's also no swappable store interface, so replicas/zero-downtime deploys later mean rewriting the auth core.

**10. Error handling is two competing systems.** The global handler knows exactly one domain error; everything else (`UnknownModelError`, `CiphertextMissingError`, …) surfaces as a 500 — a user whose model leaves Venice's catalog gets `internal_error` instead of "pick another model." Meanwhile the `{ error: { message, code } }` literal is hand-rolled ~25 times across routes and SSE error frames use a third, incompatible shape. An `HttpError` base class plus central mapping fixes all of it structurally.

### Tier 3 — erosion, drift, and papercuts

**11. The E2E suite never runs automatically, while three docs claim it gates PRs.** `e2e.yml` is `workflow_dispatch`-only (tracked as a bd issue, but `tests/e2e/README.md` and `playwright.config.ts` assert the opposite). And when it does run, it tests the *dev* images — the full-flow spec structurally requires the dev compose override, so the production artifacts self-hosters actually deploy are only smoke-tested to `/api/health`.

**12. The backend test suite is slow by construction and can never parallelize.** ~986 tests run strictly serial against one shared DB with production-cost argon2 (several hundred ms of KDF per test via real register/login), and `registerAndLogin` plus the table-wipe block are copy-pasted across ~30 test files with drifting signatures. `maxWorkers: 1` is load-bearing but undocumented — anyone "optimizing" it gets nondeterministic carnage. A test-env argon2 override and a shared helper are cheap; per-worker databases are the real fix.

**13. Editor performance degrades exactly when the product succeeds.** `shouldRerenderOnTransaction: true` plus full-doc `getJSON()` per keystroke, with the doc JSON in page state re-rendering the 746-line EditorPage tree, zero `React.memo` anywhere, and a per-keystroke word count that's computed and then discarded. Fine for short chapters; typing latency scales with chapter length.

**14. Documentation has drifted from code in load-bearing places.** `docs/encryption.md` claims an argon2 `needsRehash` upgrade path that was deleted, a recovery-code checksum that doesn't exist, and a `session_expired` UX the frontend doesn't implement — and both reviewer subagents treat that doc as source of truth. CLAUDE.md's naming table says backend files are camelCase; the codebase is kebab-case — and that table is prepended to every implementer dispatch. `.env.example` documents dead `VITE_API_URL` and omits required variables.

**15. Dead code with teeth.** `useScenes.ts` (zero importers, divergent query-key namespace that would silently never invalidate if resurrected), legacy `Editor.tsx`, `SceneComposer.tsx`, and a stranded section of `api.ts` wrappers — ~370 deletable lines that make it look like there are two data-fetching conventions.

**16. The crypto plumbing has a recurring tax and one untested failure mode.** Adding one encrypted field touches ~7 files, addressed by string convention (`writeEncrypted(req, 'title', …)` — typos compile clean, fail at runtime), and nothing fails if you forget the export/import mapping — a new field silently produces **lossy backups**, which the leak test doesn't cover. Relatedly, `import.service.ts:25` casts a transaction client to `PrismaClient` unsoundly; the first repo method to grow its own `$transaction` breaks import at runtime.

**17. Assorted user-facing papercuts:** the composer clears the typed message before send outcome is known (a guard failure — e.g. no model selected, the default first-run state — destroys it); the Venice endpoint/organization settings fields silently save nothing unless a new API key is also entered, contradicting the modal's "changes save automatically"; export is unbounded and un-rate-limited (an in-memory N+1 over the whole library); ownership is checked in up to three layers per request with inconsistent 403-vs-500 semantics; "Ask AI" can deliver its payload to the wrong composer tab.

### What this adds up to

If I had to grade it: **strong bones, fraying orchestration layer**. The invariant-bearing cores (crypto boundary, wire contract, auth flows, repo layer) are excellent and well-tested. The weakness is concentrated in the *coordination* code — route handlers and tab shells — which was copy-pasted rather than extracted, and is where the only live bugs found actually sit.
