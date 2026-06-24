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
  (`backend/src/middleware/auth.middleware.ts:79`,
  `attachDekToRequest`) for every authenticated request, sourced from the
  Option-B session store. The repo layer reads it via the request-scoped
  `WeakMap` in `content-crypto.service.ts:337`.
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

- **`User.settingsJson`** (prompt overrides, model params). It's user
  configuration, not narrative content, and it's not encrypted. Candidate for
  a v2 `"settings"` top-level key; explicitly out of v1 to keep the surface
  tight. Flagged as an open question below.
- **Venice API key**, **password / recovery wraps**, **sessions**,
  **refresh tokens**. Key material and auth state — never exported. (The
  operator-level `APP_ENCRYPTION_KEY` backup story is unrelated and unchanged.)

## API

Both endpoints mount next to the existing `/api/users/me/*` routers in
`backend/src/index.ts` (alongside `venice-key`, `settings`). Both require
`requireAuth`. Bearer-auth only (no cookies) → no `requireAllowedOrigin`
needed, consistent with the other mutating Bearer routes (e.g. `POST
/api/stories`).

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
- **Raised body limit.** The global `express.json({ limit: '256kb' })`
  (`index.ts:77`) is per-route-overridable; mount this router with a larger
  JSON parser (e.g. `express.json({ limit: '25mb' })`) — a whole-account import
  dwarfs a single narrative field. Exact ceiling is an open question (see
  Risks).
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
     (`backend/src/routes/chapters.routes.ts:58`) — do not trust the file's
     count. `summary` is applied via `chapterRepo.update(..., { summaryJson })`
     after create (create() doesn't take a summary).
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

1. **Import body size & transaction timeout.** A large account (long chat
   histories) can produce a multi-MB file and a long-running transaction.
   Prisma's interactive-transaction default timeout (5s) may be exceeded.
   Decide a body-limit ceiling and a `maxWait`/`timeout` for the tx; consider
   chunked inserts inside the tx if needed. **Open.**
2. **Include `settingsJson` in v1?** Leaning no (keep v1 narrative-only). If
   "complete migration" is the priority, add a `"settings"` key. **Open —
   user's call.**
3. **Message `createdAt` / `lastActivityAt` fidelity.** `messageRepo.create`
   stamps `createdAt = now()` and bumps `Chat.lastActivityAt`. Imported chat
   timelines therefore collapse to import time. Acceptable for v1 (content is
   preserved; only timestamps shift). Documented as known lossiness; raising it
   to faithful timestamps would need repo changes. **Accept for v1.**
4. **Rate limiting.** Import is expensive and destructive. Consider a modest
   per-user limit (the `/api/ai` limiter pattern in `index.ts:90` is the
   template). **Open.**

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
