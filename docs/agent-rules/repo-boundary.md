# Repo-Boundary & Encryption Rules Digest

> **Read by:** `/bd-execute` prepends this file (in addition to the
> lane digest) when the plan's touch-set includes the narrative-entity
> boundary — repos, narrative routes, content-crypto, the prompt
> service, or migrations on narrative tables (per
> `docs/agent-rules/index.md`).

## The invariant

**Narrative entities** (`Story`, `Chapter`, `Character`,
`OutlineItem`, `Chat`, `Message`) are accessed **only through the
repo layer** at `backend/src/repos/*.repo.ts`. Controllers,
services, and routes never call Prisma directly for these models.

The repo layer is the encrypt-on-write / decrypt-on-read seam: writes
encrypt the narrative columns before persistence, reads decrypt them
before returning, and **the API surface never sees ciphertext**. Any
code path that reads or writes one of these models without going
through its repo is a bug — even if it "just" reads a single column
that "happens not to be encrypted." It bypasses the encryption
contract; close the bypass.

Non-narrative entities (`User`, `RefreshToken`) may be accessed
directly via Prisma from services.

## Encrypt-on-write / decrypt-on-read template

Every narrative column persisted as ciphertext is stored as a
**triple**:

```
<columnName>Ciphertext   Bytes   AES-256-GCM ciphertext
<columnName>Iv           Bytes   12-byte IV (per-write random)
<columnName>AuthTag      Bytes   16-byte GCM auth tag
```

When a narrative model adds a new encrypted column:

1. Add the three columns to the Prisma schema with a migration.
2. **Both** the write path and the read path in the matching repo
   must be updated **in the same change**. Half-updates produce
   silent data loss or silent decrypt failures the next time the
   row is read.
3. The repo's read path strips the three ciphertext columns from
   the returned object — the API surface sees only the decrypted
   plaintext field.
4. If the column is computable from another plaintext (e.g.
   `wordCount` from `content`), compute it from **plaintext**
   **before** encryption, persist the plaintext-derived value, and
   never derive it from ciphertext.

## DEK & request-scoped unwrap

- Each user has a per-user random 32-byte DEK. Two AES-256-GCM
  wraps live on `User`: one keyed via argon2id from the password,
  one keyed via argon2id from the one-time recovery code. **No
  server-held KEK** wraps content.
- The content-crypto service
  (`backend/src/services/content-crypto.service.ts`) unwraps DEKs
  **only into a request-scoped `WeakMap`**. The unwrapped DEK is
  visible for the lifetime of a single request. **Module-level
  caching of unwrapped DEKs is a bug.**
- `APP_ENCRYPTION_KEY` is unrelated to narrative content. It wraps
  BYOK Venice keys only. There is no `CONTENT_ENCRYPTION_KEY`.

## Ciphertext egress: never

- **Never return ciphertext fields** (`*Ciphertext`, `*Iv`,
  `*AuthTag`, `contentDekPassword*`, `contentDekRecovery*`,
  `veniceApiKeyEnc`) from any API endpoint.
  The repo layer strips them on read; if you see one in a response,
  that path is bypassing the repo.
- **Never log ciphertext** even in dev. It serves no debugging
  purpose and pollutes log sinks.
- **Never persist plaintext narrative content outside the repo
  layer** — no caches, no tmp files, no export intermediates that
  don't delete on error. If a feature genuinely needs persisted
  plaintext, that's a design conversation, not a code change.

## Plaintext narrative content: where it may and may not appear

| Sink | Dev | Production |
|---|---|---|
| Logs / `console.error` for prompt debugging | **Allowed** (intentional, prompt/Venice debugging needs it) | **Forbidden** |
| `<DevErrorOverlay>` "Show raw" | Allowed | Forbidden (overlay is dev-only by build) |
| Response body to **the owning user's own GET** | Allowed | Allowed |
| Response body to anyone else | Forbidden | Forbidden |
| Telemetry, metrics, error trackers | Forbidden | Forbidden |

The leak test (`[E12]`) inserts a sentinel string and asserts it is
absent from every raw row in narrative tables. Run it after **any**
change to the repo layer, schema, or narrative migrations. The
production logging rule is enforced by the same test pattern at the
log-sink level when adding new sinks.

## The prompt service is a boundary consumer, not a bypass

`backend/src/services/prompt.service.ts` reads chapter bodies for
context assembly. It receives **decrypted plaintext** from the
chapter repo — it must **never** reach across the repo to read raw
Prisma rows. If you find yourself wanting to import `PrismaClient`
into the prompt service, stop and route through the repo.

Decrypted bodies in the prompt service exist only for the lifetime
of the request that triggered the AI call. They are not memoized at
module scope.

## Migrations on narrative tables

- Add ciphertext columns in batches when possible (one migration
  for several at-rest fields beats six migrations).
- Plan the schema change explicitly — schema changes after the
  initial migration require approval (CLAUDE.md "When to Stop and
  Ask").
- **Pre-deployment, there are no users, no stored content, no
  legacy rows.** Do not write dual-write / lazy-backfill / "read
  plaintext if ciphertext null" branches. They handle a population
  that does not exist. The codebase was scrubbed of every such
  branch post-`[X10]`; reintroduce one only with a dated TODO and
  a real reason.

## Chapter bodies, specifically

- `Chapter.content` is the **TipTap JSON tree**, decrypted on read
  via the chapter repo.
- `Chapter.wordCount` is a plaintext column, derived from the JSON
  tree **before encryption** on each write. **Order matters:**
  parse JSON → count words → write ciphertext + plaintext
  `wordCount` in one repo call. Don't try to derive word count
  from ciphertext (you can't), and don't update `wordCount` on a
  read path (it'll go stale silently).
- The historical `Chapter.content` plaintext mirror from
  `[D4]`/`[D10]` was deliberately dropped in `[E5]`/`[E11]`. The
  decrypted JSON tree (via the repo) is the sole source of truth.

## Verification checklist before opening a PR that touches the boundary

- [ ] Every read path in changed repos goes through `decrypt`.
- [ ] Every write path goes through `encrypt`.
- [ ] No `*Ciphertext` / `*Iv` / `*AuthTag` field is included in
      any API response shape.
- [ ] The leak test (`[E12]`) was run and passed.
- [ ] If a column was added: both write **and** read paths in the
      matching repo were updated in this change, not split across
      PRs.
- [ ] No plaintext narrative content was added to any new log
      sink, telemetry sink, or error reporter.
- [ ] No `PrismaClient` import was added to a service or route
      module that previously had none for a narrative table.

## Forbidden

- Bypassing the repo layer for any narrative entity, including
  ad-hoc scripts under `backend/prisma/scripts/**` or
  `scripts/**`.
- Returning ciphertext fields from any endpoint.
- Logging plaintext narrative content in production sinks.
- Persisting plaintext narrative content outside the repo layer.
- Module-level / process-wide caching of unwrapped DEKs.
- Adding a `CONTENT_ENCRYPTION_KEY` env var (the boot validator
  warns; the design rejects it).
