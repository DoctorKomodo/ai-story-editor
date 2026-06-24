# Agent-Rules Index — Path-Glob → Digest Mapping

> **Read by:** `/bd-execute` consults this file to pick which digest(s)
> to prepend to the implementer + task-reviewer prompts, based
> on the plan's touch-set.
>
> **Resolution:** match each plan path against the globs below
> top-to-bottom; **union** the matched digests (a plan that touches
> both backend and frontend gets all matched digests, not the first
> match). When in doubt about narrative-adjacency, include
> `repo-boundary.md` — its rules don't conflict with the lane
> digests.

## Mapping

> **`general.md` is part of every match.** It carries cross-cutting
> rules (TS strict, comments policy, YAGNI, dependency policy,
> secrets, library-version awareness)
> that apply regardless of lane. Listed explicitly on every row so
> the union mechanism stays uniform — no special-case "always
> prepend" logic in the bridge skill.

| Path glob | Digests to prepend |
|---|---|
| `backend/src/**` | `general.md` + `backend.md` |
| `backend/src/repos/**` | `general.md` + `backend.md` + `repo-boundary.md` |
| `backend/src/routes/stories.routes.ts` | `general.md` + `backend.md` + `repo-boundary.md` |
| `backend/src/routes/chapters.routes.ts` | `general.md` + `backend.md` + `repo-boundary.md` |
| `backend/src/routes/characters.routes.ts` | `general.md` + `backend.md` + `repo-boundary.md` |
| `backend/src/routes/outline.routes.ts` | `general.md` + `backend.md` + `repo-boundary.md` |
| `backend/src/routes/chat.routes.ts` | `general.md` + `backend.md` + `repo-boundary.md` |
| `backend/src/services/content-crypto.service.ts` | `general.md` + `backend.md` + `repo-boundary.md` |
| `backend/src/services/prompt.service.ts` | `general.md` + `backend.md` + `repo-boundary.md` |
| `backend/src/lib/serialize.ts` | `general.md` + `backend.md` + `repo-boundary.md` *(narrative wire-shape boundary)* |
| `backend/prisma/schema.prisma` | `general.md` + `backend.md` + `repo-boundary.md` *(narrative tables present)* |
| `backend/prisma/migrations/**` | `general.md` + `backend.md` + `repo-boundary.md` *(if migration touches narrative columns; otherwise drop `repo-boundary.md`)* |
| `backend/prisma/scripts/**` | `general.md` + `backend.md` + `repo-boundary.md` *(drop `repo-boundary.md` unless the script touches narrative tables)* |
| `backend/scripts/**` | `general.md` + `backend.md` *(+ `repo-boundary.md` if the script touches narrative tables)* |
| `scripts/**` | `general.md` *(+ `backend.md` for backend TS; + `repo-boundary.md` if it touches narrative tables)* |
| `backend/tests/**` | `general.md` + `backend.md` |
| `frontend/src/**` | `general.md` + `frontend.md` |
| `frontend/tests/**` | `general.md` + `frontend.md` |
| `frontend/scripts/**` | `general.md` + `frontend.md` *(design-token tooling — e.g. `lint-design.mjs`)* |
| `tests/e2e/**` | `general.md` + `frontend.md` *(E2E sits at the frontend integration boundary)* |
| `shared/src/**` | `general.md` *(shared schemas are library-only and authoritative for the wire format; consumer-lane digests still apply for the consumer-side touch-set entries in cross-boundary plans)* |
| `shared/tests/**` | `general.md` |

## When the touch-set is mixed

A plan that creates a new narrative-entity feature usually touches:

- a backend route file → `backend.md` + `repo-boundary.md`
- a backend repo → `backend.md` + `repo-boundary.md`
- a frontend hook + component → `frontend.md`

Result: union → `backend.md` + `frontend.md` + `repo-boundary.md`.
That's the expected steady state for cross-boundary features.

## Narrative-adjacency hint for migrations

A migration is **narrative-adjacent** (→ add `repo-boundary.md`) when it:

- Creates / alters / drops a column on `Story`, `Chapter`,
  `Character`, `OutlineItem`, `Chat`, or `Message`.
- Adds / removes a `*Ciphertext` / `*Iv` / `*AuthTag` triple on one of
  those six narrative models.

The `User` DEK-wrap columns (`contentDekPassword*` /
`contentDekRecovery*`) and the BYOK Venice-key columns (`veniceApiKeyEnc`
…) are **not** narrative — they're `backend.md` "Encryption at rest"
territory (and `security-reviewer`'s surface), not `repo-boundary.md`.
For these, and for other non-narrative migrations (`User`
auth/profile fields like `username` / `email`), `backend.md` alone
suffices.

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
