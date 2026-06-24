# Repo-Boundary & Encryption Rules Digest

> **Read by:** `/bd-execute` prepends this file (in addition to the
> lane digest) when the plan's touch-set includes the narrative-entity
> boundary — repos, narrative routes, content-crypto, the prompt
> service, or migrations on narrative tables (per
> `docs/agent-rules/index.md`). It is **always co-prepended with
> `backend.md`** (the narrative boundary is backend-only), so it does
> **not** restate backend.md's encryption-at-rest / auth rules — only the
> repo-boundary specifics.

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

Non-narrative entities (`User`) may be accessed
directly via Prisma from services.

## Repo shape & helpers

- A repo is a `createXRepo(req, client = defaultPrisma)` factory returning
  method objects. `resolveUserId(req)` throws if `req.user` is unset.
- **Encrypt/decrypt only through the `_narrative.ts` helpers**, never raw
  AES: `writeEncrypted(req, field, value)` on write, `projectDecrypted(req,
  row, FIELDS)` on read, where `FIELDS` is the shared
  **`*_ENCRYPTED_FIELD_KEYS`** tuple (the single source of truth for which
  columns are encrypted). They pull the DEK off the request; a method
  reached without auth throws `DekNotAvailableError`.
- **Every read and write is owner-scoped at the data layer** — defense in
  depth, independent of the ownership middleware. Scope every query by
  owner: `where: { id, userId }` (Story) or the parent chain
  (`{ id, story: { userId } }`, … down to Message); creates verify the
  parent first (`ensureStoryOwned`). Dropping the scope is a cross-tenant
  leak. Unknown and unowned ids conflate to one error (→ 403) — no
  enumeration oracle.
- **The repo returns a `Repo<Entity>` shape, not the wire shape.**
  `projectDecrypted` strips only the ciphertext triples; the object still
  carries `Date` timestamps and owner ids (`userId` / `chatId`). The
  matching `serialize*` helper (`src/lib/serialize.ts`) produces the wire
  shape — an explicit pick (not spread) that drops owner ids and converts
  `Date`→ISO — then `respond` validates it. Stripping ciphertext is
  necessary but not sufficient; `serialize*` is the egress boundary.

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
2. Add the field name to the shared **`*_ENCRYPTED_FIELD_KEYS`** tuple —
   the `FIELDS` list `projectDecrypted` reads. (The key is the column base
   name, e.g. `body`; the wire field may differ, e.g. `bodyJson`.)
3. **Both** the write path and the read path in the matching repo
   must be updated **in the same change**. Half-updates produce
   silent data loss or silent decrypt failures the next time the
   row is read. If a read `select`s a ciphertext column, select **all
   three** triple parts together with the `projectDecrypted` call — a
   partial select throws `CiphertextMissingError`.
4. The repo's read path strips the three ciphertext columns from
   the returned object — the API surface sees only the decrypted
   plaintext field.
5. If the column is computable from another plaintext (e.g.
   `wordCount` from `content`), compute it from **plaintext**
   **before** encryption, persist the plaintext-derived value, and
   never derive it from ciphertext.

## DEK (request-scoped)

The envelope model (per-user DEK, two argon2id wraps, no server-held KEK), the
request-scoped `WeakMap` unwrap (no module-level caching), and the
no-`CONTENT_ENCRYPTION_KEY` policy live in
**backend.md "Encryption at rest"** (always co-prepended). The repo
reaches the DEK only through the request-scoped `_narrative.ts` helpers
(see "Repo shape & helpers").

## Ciphertext egress: never

- **Never return narrative ciphertext triples** (`*Ciphertext`, `*Iv`,
  `*AuthTag`) from any endpoint. The narrative repo strips them on read
  (`stripCiphertextFields`); a triple in a response means a path bypassed
  the repo. (The `User` secret columns — `contentDekPassword*`,
  `contentDekRecovery*`, `veniceApiKeyEnc` — are **not** narrative and the
  repo never touches them; they're security-reviewer's lane, kept off the
  wire by the auth / venice-key routes.)
- **Never log ciphertext** even in dev. It serves no debugging
  purpose and pollutes log sinks.
- **Never log a caught decrypt/parse exception.** A `ZodError` /
  `SyntaxError` thrown over a decrypted-but-invalid blob can embed the
  plaintext in its message — log a static code + entity id only (e.g.
  `summary_parse_failed chapter=<id>`), never the exception object.
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

The general migration rules (run against real, populated tables; batch
ciphertext columns; schema changes need approval) are in **backend.md
"Database access"**. The narrative-specific addition:

- **Existing rows are real** (the app is at/near release). But the
  server has **no DEK at migration time** — it's per-user, unwrapped
  only inside an authed request — so you **cannot** backfill a new
  encrypted narrative column offline. Add the triple **nullable**;
  old rows read as `null` (`readEncrypted` returns `null` for a
  full-null triple) until the owner next saves that row and the repo
  populates it (populate-on-write). Plan that explicitly, and treat a
  narrative-column breaking change as a stop-and-ask (CLAUDE.md "When
  to Stop and Ask"). Plaintext / non-narrative columns backfill
  normally.

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

## Forbidden

- Bypassing the repo layer for any narrative entity, including
  ad-hoc scripts under `backend/prisma/scripts/**` or
  `scripts/**`.
- Returning ciphertext fields from any endpoint.
- Logging plaintext narrative content in production sinks.
- Persisting plaintext narrative content outside the repo layer.
- Module-level / process-wide caching of unwrapped DEKs.
- Adding a `CONTENT_ENCRYPTION_KEY` or any new server-held encryption
  env var without explicit design review (the boot validator warns on
  `CONTENT_ENCRYPTION_KEY`; adding a different name requires the same
  threat-model update described in `docs/encryption.md` Revisit #1).
