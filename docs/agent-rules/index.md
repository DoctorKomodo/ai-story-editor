# Agent-Rules Index — Path-Glob → Digest Mapping

> **Read by:** `/bd-execute` consults this file to pick which digest(s)
> to prepend to the implementer + code-quality-reviewer prompts, based
> on the plan's touch-set.
>
> **Resolution:** match each plan path against the globs below
> top-to-bottom; **union** the matched digests (a plan that touches
> both backend and frontend gets all matched digests, not the first
> match). When in doubt about narrative-adjacency, include
> `repo-boundary.md` — its rules don't conflict with the lane
> digests.

## Mapping

| Path glob | Digests to prepend |
|---|---|
| `backend/src/**` | `backend.md` |
| `backend/src/repos/**` | `backend.md` + `repo-boundary.md` |
| `backend/src/routes/stories.routes.ts` | `backend.md` + `repo-boundary.md` |
| `backend/src/routes/chapters.routes.ts` | `backend.md` + `repo-boundary.md` |
| `backend/src/routes/characters.routes.ts` | `backend.md` + `repo-boundary.md` |
| `backend/src/routes/outline.routes.ts` | `backend.md` + `repo-boundary.md` |
| `backend/src/routes/chat.routes.ts` | `backend.md` + `repo-boundary.md` |
| `backend/src/services/content-crypto.service.ts` | `backend.md` + `repo-boundary.md` |
| `backend/src/services/prompt.service.ts` | `backend.md` + `repo-boundary.md` |
| `backend/src/services/ai.service.ts` | `backend.md` + `repo-boundary.md` |
| `backend/prisma/schema.prisma` | `backend.md` + `repo-boundary.md` *(narrative tables present)* |
| `backend/prisma/migrations/**` | `backend.md` + `repo-boundary.md` *(if migration touches narrative columns; otherwise drop `repo-boundary.md`)* |
| `backend/tests/**` | `backend.md` |
| `frontend/src/**` | `frontend.md` |
| `frontend/tests/**` | `frontend.md` |
| `tests/e2e/**` | `frontend.md` *(E2E sits at the frontend integration boundary)* |
| `shared/src/**` | *(no digest)* — shared schemas are library-only and authoritative for the wire format; consumer-lane digests still apply for the consumer-side touch-set entries |
| `shared/tests/**` | *(no digest)* |

## When the touch-set is mixed

A plan that creates a new narrative-entity feature usually touches:

- a backend route file → `backend.md` + `repo-boundary.md`
- a backend repo → `backend.md` + `repo-boundary.md`
- a frontend hook + component → `frontend.md`

Result: union → `backend.md` + `frontend.md` + `repo-boundary.md`.
That's the expected steady state for cross-boundary features.

## Narrative-adjacency hint for migrations

A migration is **narrative-adjacent** when it:

- Creates / alters / drops a column on `Story`, `Chapter`,
  `Character`, `OutlineItem`, `Chat`, or `Message`.
- Adds / removes a `*Ciphertext` / `*Iv` / `*AuthTag` triple.
- Touches `User.contentDekPassword*` or `User.contentDekRecovery*`
  (the DEK wraps).

For other migrations (e.g. `RefreshToken` schema, `User.username`
metadata fields), `repo-boundary.md` is not required —
`backend.md` alone suffices.

## What's NOT in this index

- **Workflow / orchestration rules** stay in `CLAUDE.md` (Task
  Completion Protocol, When to Stop and Ask, Testing Rules
  workflow policy, Docker & Infrastructure, Git Rules, Naming
  Conventions, gate documentation pointers, Known Gotchas,
  Architecture Rules — General). The digests are about
  *implementation* rules; CLAUDE.md is about *how to work*.
- **Surface-reviewer prompts.** `security-reviewer` and
  `repo-boundary-reviewer` keep their own prompts under
  `.claude/agents/`. They are invoked by `/bd-close-reviewed`
  via diff-path matching, separately from the digest mechanism.

## Updating

Edit this file when you add a new repo, a new top-level lane, or
move a file that's referenced above. Prefer adding a row over
expanding a glob — explicit beats clever, and the bridge skill
greps the table verbatim.
