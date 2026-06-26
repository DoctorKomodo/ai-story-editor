# User Content Backup & Restore (Export / Import) — Design

**Date:** 2026-06-24
**Status:** Draft — pending written-spec review
**Scope:** New user-facing feature. Backend: two endpoints under `/api/users/me`. Shared: export/import Zod schemas + wire types. Frontend: a "Backup & Restore" section in Settings.

## Goal

Let a signed-in user **export all of their own narrative content** to a single
portable JSON file, and **restore** from such a file. This is a per-user,
content-level backup that complements (does not replace) the operator-level
`pg_dump` (`scripts/backup-db.sh`) — see "Relationship to the operator backup"
below.

The feature exists to give an individual user a way to:
- self-insure against account/data loss without depending on the operator,
- migrate their work between Inkwell instances,
- keep an offline archive of their writing in a readable format.

## Decisions already taken (direction-approved 2026-06-15)

1. **Export format: plaintext JSON.** The file contains the user's decrypted
   narrative content. Portable, human-readable, re-importable, instance- and
   account-independent. The user owns securing the downloaded file.
2. **Restore semantics: replace-all.** Import wipes the caller's existing
   narrative content and recreates it from the file. No merge, no upsert, no
   ID reconciliation.
3. **Operator scripts (`backup-db.sh`, `backup-restore-drill.sh`): decision
   deferred.** Out of scope for this spec; left exactly as they are.

## Why this fits the architecture (verified facts)

The single most important fit: **export and import are "just another
authenticated request."** No new key handling is required.

- The request-scoped DEK is attached by `requireAuth`
  (`backend/src/middleware/auth.middleware.ts:47`, `attachDekToRequest`) for
  every authenticated request. `requireAuth` resolves the caller from the
  opaque httpOnly **session cookie** (`auth.middleware.ts:31`) and pulls the
  DEK out of the in-memory session store. The repo layer reads it via the
  request-scoped `WeakMap` in `content-crypto.service.ts:337`.
- Therefore **export = decrypt-on-read through the repos**, and **import =
  encrypt-on-write through the repos**, using the caller's own DEK. The
  existing `projectDecrypted` / `writeEncrypted` machinery
  (`backend/src/repos/_narrative.ts`) does all the crypto. No endpoint touches
  ciphertext, DEKs, or wrap columns directly.
- **Plaintext narrative in the export response body is permitted.** CLAUDE.md's
  egress rule forbids decrypted narrative content in any sink *outside the
  owning user's own GET*. An authenticated user reading their own content back
  is exactly the allowed case (same category as `GET /api/stories/:id`).
- **Plaintext JSON is DEK-independent.** Because the file holds plaintext (not
  ciphertext tied to a DEK), import re-encrypts under the *importing* user's
  DEK. A file exported from account A imports cleanly into account B / another
  instance. This is the property that makes migration work.

### The ownership graph (drives both export shape and replace-all)

```
User
└── Story            (title, synopsis, worldNotes encrypted; genre, targetWords, includePreviousChaptersInPrompt plaintext)
    ├── Chapter      (title, body[TipTap JSON], summaryJson encrypted; status, orderIndex, wordCount plaintext)
    │   └── Chat     (title encrypted; kind plaintext)
    │       └── Message  (content, attachmentJson, citationsJson encrypted; role, model, tokens, latencyMs plaintext)
    ├── Character    (name, role, age, appearance, voice, arc, relationships, personality, backstory encrypted; color, initial, orderIndex plaintext)
    └── OutlineItem  (title, sub encrypted; status, order plaintext)
```

Every relation cascades on delete (`onDelete: Cascade` in
`schema.prisma`). So **replace-all wipe = delete the caller's `Story` rows**;
the cascade removes the entire subtree. The `User` row itself
(password, DEK wraps, Venice key, `settingsJson`, sessions) is **never
touched** — the user stays logged in, their DEK and key are preserved.

## Export format

A **fully-nested tree**, so there are no cross-entity ID references to remap on
import — children are nested under parents, never joined by id.

```jsonc
{
  "formatVersion": 1,
  "app": "inkwell",
  "exportedAt": "2026-06-24T12:00:00.000Z",   // informational only
  "stories": [
    {
      "title": "…", "synopsis": "…", "genre": "…", "worldNotes": "…",
      "targetWords": 80000, "includePreviousChaptersInPrompt": true,
      "chapters": [
        {
          "title": "…", "status": "draft", "orderIndex": 0,
          "bodyJson": { "type": "doc", "content": [ … ] },   // TipTap tree
          "summary": { … } | null,
          "chats": [
            {
              "title": "…" | null, "kind": "ask",
              "messages": [
                { "role": "user", "content": "…", "attachmentJson": null,
                  "citationsJson": null, "model": null, "tokens": null,
                  "latencyMs": null, "createdAt": "…" }
              ]
            }
          ]
        }
      ],
      "characters": [ { "name": "…", "role": "…", /* … all narrative fields */ "color": "…", "initial": "…", "orderIndex": 0 } ],
      "outlineItems": [ { "title": "…", "sub": "…" | null, "status": "…", "order": 0 } ]
    }
  ]
}
```

Notes:
- **Database IDs (`id`, `storyId`, `chapterId`, `chatId`, timestamps) are
  intentionally NOT round-tripped** as identity. Import always mints fresh
  `cuid`s. `createdAt` on messages is carried for display/order intent but is
  advisory (see "Known lossiness").
- `formatVersion` is the compatibility gate. Import rejects anything it does
  not recognise rather than guessing.
- `wordCount` is **derived on import**, not trusted from the file (the file may
  be hand-edited) — see import step 4.

### What is NOT in the export (v1)

- **`User.settingsJson`** (prompt overrides, model params). **Decided: out of
  v1** — it's user configuration, not narrative content, so v1 stays
  narrative-only to keep the surface tight. Reserved as a v2 `"settings"`
  top-level key if "complete account migration" becomes a goal.
- **Venice API key**, **password / recovery wraps**, **sessions**,
  **refresh tokens**. Key material and auth state — never exported. (The
  operator-level `APP_ENCRYPTION_KEY` backup story is unrelated and unchanged.)

## API

Both endpoints mount next to the existing `/api/users/me/*` routers in
`backend/src/index.ts` (alongside `venice-key`, `settings`). Both require
`requireAuth`.

**Auth & CSRF (cookie-session model).** Auth is the opaque httpOnly session
cookie (PR #140) — there is no Bearer/JWT path. Both endpoints therefore
inherit the **global** `requireAllowedOrigin` Origin/Referer check mounted at
`index.ts:95` (`app.use('/api', requireAllowedOrigin(...))`). For the
destructive `POST import` that global check **is** the CSRF defense, and it is
sufficient — no per-route CSRF token is needed — precisely because import
honours CLAUDE.md's "Cookie-session auth CSRF posture" invariants: it is a
state-changing **POST** (not a GET), and it is parsed by `express.json()` only
(no urlencoded/multipart parser), so SameSite=Lax + the global Origin/Referer
default-deny cover it. `GET export` is read-only, so it introduces no
state-changing-GET hole.

### `GET /api/users/me/export`

- Assembles the full tree **in memory** via the per-request repos, decrypting
  on read. **No server-side temp file** is written (CLAUDE.md "Stop and Ask":
  never persist plaintext narrative to disk outside the repo layer).
- Response: `200`, `Content-Type: application/json`,
  `Content-Disposition: attachment; filename="inkwell-backup-<username>-<YYYYMMDD>.json"`,
  body = the export object.
- Reads use the existing repo methods: `storyRepo.findManyForUser()`, then per
  story `chapterRepo.findManyForStory(id, { includeSummary: true })` +
  `chapterRepo.findById` for bodies, `characterRepo.findManyForStory`,
  `outlineRepo.findManyForStory`, `chatRepo.findManyForChapter`,
  `messageRepo.findManyForChat`. (Body fetch needs `findById` per chapter
  because `findManyForStory` is metadata-only by design.)

### `POST /api/users/me/import`

- Body: an export object. Validated against `importSchema` (shared Zod) —
  composed from the existing per-entity create schemas so imported rows satisfy
  exactly the same constraints as API-created rows (title lengths, status
  enums, `worldNotes` 50k cap, etc.).
- **Raised body limit — path-scoped, mounted before the global parser.** The
  global `express.json({ limit: '256kb' })` (`index.ts:89`) gates *incoming
  request bodies* and was sized to fit the largest single narrative-field write
  (`worldNotes`, 50k chars ≈ ~200KB worst-case UTF-8 + JSON overhead — see the
  `index.ts:87` comment). A whole-account import carries *every* chapter, chat,
  and message at once, so it legitimately needs far more headroom. **Mount a
  path-scoped `express.json({ limit: '25mb' })` on `/api/users/me/import`
  *before* the global 256kb parser** — Express runs the first matching parser,
  which sets `req._body = true`, and the later global parser then skips. (A
  larger parser mounted *after* the global one would never run: the 256kb
  parser would already have rejected the body with `413`.) The rest of the API
  keeps the tight 256kb ceiling; only import accepts large bodies. 25mb is the
  proposed ceiling (see Risks for the size/timeout coupling).
  - *Note (out of scope):* Venice flows do not interact with this limit —
    Venice's SSE responses are streamed and never pass through `express.json`,
    and the requests that trigger Venice carry only IDs + a short payload
    (context is assembled server-side in `prompt.service`), not the corpus.
- **Replace-all, transactional.** The entire wipe-then-recreate runs inside a
  single interactive `prisma.$transaction` so a mid-import failure rolls back
  and leaves the user's *original* data intact:
  1. `tx.story.deleteMany({ where: { userId } })` → cascade wipes the subtree.
  2. For each story in the file (in array order): create story → chapters →
     (chats → messages), characters, outline, threading the `tx` client into
     the repo factories (`createStoryRepo(req, tx)` etc.).
  3. Re-sequence `orderIndex` / `order` to `0..n-1` per parent on the way in
     (sort by the file's value, then reassign) so a hand-edited file with gaps
     or dupes can't violate the `@@unique([storyId, orderIndex])` /
     `@@unique([storyId, order])` constraints.
  4. Derive `wordCount` per chapter from `bodyJson` using the same
     `computeWordCount` / `tipTapJsonToText` path the chapter routes use
     (`backend/src/routes/chapters.routes.ts:59`) — do not trust the file's
     count. `summary` is applied via `chapterRepo.update(..., { summaryJson })`
     after create (create() doesn't take a summary).
- **Rate limit (decided).** Import is expensive and destructive, so it gets a
  modest per-user limiter, built on the same `express-rate-limit` pattern as
  the `/api/ai` limiter (`index.ts:90`) and the auth limiters
  (`auth.routes.ts`). A handful of imports per hour is ample for legitimate use
  and bounds both abuse and accidental repeat-fires. Exact window/limit is a
  tuning detail for the plan.
- Response: `200`, `{ imported: { stories, chapters, characters, outlineItems, chats, messages } }`.

#### Repo/transaction note (implementation flag)

The repo factories accept `client: PrismaClient = defaultPrisma`. Prisma's
interactive-transaction client is `Omit<PrismaClient, '$transaction' | …>`,
which may not be assignable to `PrismaClient` at the type level. Verify and, if
needed, widen the repos' `client` param to the transaction-client type (a
mechanical, low-risk change touching every repo signature). This must be
settled in the plan because it touches the repo boundary.

## Frontend

A new **"Backup & Restore"** (or "Your data") section in Settings.

- **Export:** a button → `GET /api/users/me/export` as a blob → trigger a
  browser download. No new screen.
- **Restore (replace-all):**
  1. File picker → read + `JSON.parse` → validate client-side against the
     shared `importSchema` (instant feedback; reuses the same schema the
     backend enforces).
  2. Show a **summary** of what the file contains (N stories, M chapters, …)
     and what currently exists (it will be **deleted**).
  3. **Safety net:** before the destructive call, the UI **automatically
     triggers a fresh export download** of the current account, so a
     fat-fingered restore is always recoverable. (Server stores nothing — the
     safety net is the auto-downloaded file.)
  4. **Typed confirmation:** the user must type a fixed phrase (e.g. `replace
     everything`) to enable the Restore button — this is destructive and
     irreversible server-side.
  5. POST → on success, invalidate all TanStack Query caches (or hard reload)
     so the UI reflects the restored tree.

## Shared

Add to `shared/src/schemas`:
- `exportSchema` / `Export` type — the file shape above, `formatVersion`
  literal-gated.
- `importSchema` — structurally identical; composed from existing create
  schemas (`storyCreateSchema`, character/outline/chat create schemas, message
  shape) plus the structural fields (`orderIndex`, `status`, nested arrays).
- `importResultSchema` — the `{ imported: {...} }` count summary.

Reusing the create schemas keeps one source of truth for field constraints and
guarantees imported data is exactly as valid as interactively-created data.

## Relationship to the operator backup

| | `backup-db.sh` (operator) | This feature (user) |
|---|---|---|
| Scope | whole DB, all users | one user's own content |
| Form | ciphertext (needs keys) | plaintext, readable |
| Audience | operator | end user |
| Recovery proof | `backup-restore-drill.sh` | the round-trip test (below) |

They are complementary. This spec does not change, remove, or depend on the
operator scripts.

## Security & review surface

- **`security-reviewer`** — touches `/api/users/me/*` auth surface and emits
  the user's full plaintext content in a response. Confirm: export is
  `requireAuth` + caller-scoped (no userId from the request body — always
  `req.user.id`); import never logs the payload; errors never echo content
  (the `validateBody` / global-error paths already avoid this, but the import
  catch site must not `console.error` the body).
- **`repo-boundary-reviewer`** — export/import must go **through the repos**,
  never raw Prisma for narrative reads/writes; the only raw Prisma allowed is
  the `tx.story.deleteMany` wipe (structural, no narrative columns) and it must
  be userId-scoped. Confirm encrypt-on-write / decrypt-on-read symmetry holds
  for every imported entity.
- **Leak test [E12]** — unaffected: the export response is the sanctioned
  owning-user GET; nothing new is written to logs or to non-owner sinks.

## Risks / open questions

1. **Transaction timeout (genuine open question).** A large account (long chat
   histories) can produce a multi-MB import and a long-running interactive
   transaction. Prisma's interactive-transaction default timeout (5s) may be
   exceeded. Set an explicit `maxWait`/`timeout` on the `$transaction`, and if
   that proves insufficient consider batched inserts inside the tx. The exact
   values are a tuning call for the plan. **Open.**
   - *Body size is resolved* (no longer coupled here): a path-scoped 25mb
     parser on `/api/users/me/import`, mounted before the global 256kb parser —
     see the import endpoint section.
2. **Message `createdAt` / `lastActivityAt` fidelity.** `messageRepo.create`
   stamps `createdAt = now()` and bumps `Chat.lastActivityAt`. Imported chat
   timelines therefore collapse to import time. Acceptable for v1 (content is
   preserved; only timestamps shift). Documented as known lossiness; raising it
   to faithful timestamps would need repo changes. **Accept for v1.**
3. **Per-chapter 256kb ceiling (pre-existing, cross-reference only).** Because
   `bodyJson` is `z.unknown()` with no `.max()` (`shared/src/schemas/chapter.ts`),
   the only bound on a single chapter's TipTap body is the global 256kb request
   parser — a chapter that serialises past ~256kb (very roughly ~20k words)
   gets an opaque `413` on save *today*. This is unrelated to export/import
   (import gets its own 25mb parser), but the export round-trip surfaces it: a
   chapter that imports fine inside the 25mb payload could fail a later
   *individual* save under the 256kb route limit. Out of scope for this spec;
   tracked separately as `story-editor-ylb`. **Not blocking.**

### Resolved (were open at draft)

- **`settingsJson` in v1 → no.** v1 is narrative-only; v2 `"settings"` key
  reserved. (See "What is NOT in the export".)
- **Rate limiting → yes.** Modest per-user limiter on import, `/api/ai`-style.
  (See the import endpoint section.)

## Known lossiness (v1, by design)

- Database IDs and original `createdAt`/`updatedAt` are not restored (fresh
  rows). Message timestamps collapse to import time.
- `summaryJsonUpdatedAt` / summary-staleness flags reset.
- User settings, Venice key, and auth state are not part of the backup.

## Verification

- Backend integration test: register → seed a story tree (stories, chapters
  with bodies, characters, outline, chats, messages) → `GET export` → assert
  the tree decrypts and matches → mutate/delete some content → `POST import`
  with the exported file → assert the account matches the file and the old
  mutations are gone (replace-all). Goes through the repo layer (per testing
  rules), reusing the real test DB.
- Round-trip parity check: export → import → export again → the two exports are
  equal modulo `exportedAt` and minted IDs/timestamps.
- This is the per-user analogue of `backup-restore-drill.sh`'s
  encrypted-round-trip proof, but at the content layer.
```
