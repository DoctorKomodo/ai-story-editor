# General Rules Digest (cross-cutting)

> **Read by:** `/bd-execute` prepends this file to every implementer
> + code-quality-reviewer dispatch, alongside whatever lane digests
> the touch-set resolves to. These rules apply regardless of where
> the work lands — backend, frontend, shared, tests, scripts.
>
> Rules unique to a lane live in that lane's digest
> (`backend.md`, `frontend.md`, `repo-boundary.md`). This file
> avoids duplicating them; if you find a rule here that's also
> in a lane digest, deduplicate by removing from the lane.

## TypeScript discipline

- Strict mode is on. **No `any` types.** Prefer `unknown` plus a
  narrowing guard when the shape is genuinely dynamic. Reach for
  `as` casts only when there's no alternative and document the
  invariant in a single-line comment.

## Comments

- **Default to writing no comments.** Only add one when the WHY is
  non-obvious: a hidden constraint, a subtle invariant, a workaround
  for a specific bug, behavior that would surprise a reader. If
  removing the comment wouldn't confuse a future reader, don't write
  it.
- Don't explain WHAT the code does — well-named identifiers already
  do that. Don't reference the current task, fix, or callers ("used
  by X", "added for the Y flow", "handles the case from issue #123")
  — those belong in the PR description and rot as the codebase
  evolves.

## Scope discipline (YAGNI)

- Don't add features, refactor, or introduce abstractions beyond
  what the task requires. A bug fix doesn't need surrounding cleanup;
  a one-shot operation doesn't need a helper. Don't design for
  hypothetical future requirements. Three similar lines beats a
  premature abstraction.
- Don't add error handling, fallbacks, or validation for scenarios
  that can't happen. Trust internal code and framework guarantees.
  Only validate at system boundaries (user input, external APIs).
- Avoid backwards-compatibility hacks: renaming unused `_vars`,
  re-exporting types, adding `// removed` comments for deleted code,
  feature flags or compat shims you can just inline. If something is
  certainly unused, delete it.

## Pre-deployment: no data-migration branches

- Pre-deployment, there are no users, no stored content, and no
  legacy rows. Code paths that exist only to handle "pre-[Tn]"
  shapes (null wrap columns, bcrypt hashes, plaintext-only rows,
  optional `sessionId` claims, dual-write toggles, lazy-backfill
  reads, "read plaintext if ciphertext null" fallbacks) serve a
  population that doesn't exist and cost complexity + test surface
  + review burden.
- When a task's rollout plan asks for a dual-write, lazy-backfill,
  or legacy-read fallback, **skip it and implement the post-rollout
  shape directly**. If the app is ever deployed against pre-existing
  data in future, reintroduce only the specific branch needed for
  that actual population with a dated TODO for its removal.
- The codebase was scrubbed of every such branch post-`[X10]`
  (bcrypt removed, sessionId required, lazy wraps deleted, plaintext
  fallbacks deleted). Don't reintroduce them.

## Dependencies

- Install the current stable mainline by default, not whatever range
  the LLM remembers. Before adding a new package — or pinning one
  that doesn't already exist in `package.json` — check the current
  stable via `npm view <pkg> version` and, if the major-version jump
  matters (Express 4 → 5, Vite 5 → 8, Tiptap 2 → 3, Zod 3 → 4),
  `npm view <pkg> versions --json | tail` to confirm the latest stable.
- Pin to the latest stable. Going in on an older major needs a real
  reason recorded in the commit (e.g. "blocked on upstream peer X"
  with a removal trigger), not silence.
- Applies equally to `dependencies`, `devDependencies`,
  `peerDependencies`, and tooling pulled in via skill / hook / agent
  glue. Exception: intentional downgrades to dodge a known regression
  — same commit-message justification.

## Library-version awareness

- For fast-moving libraries (TypeScript / Zod / Vitest in shared
  + lane-specifics in `backend.md` / `frontend.md`), **prefer the
  Context7 MCP `query-docs` tool over muscle-memory recall** for
  syntax and migration questions — training data lags. Use it
  whenever you'd otherwise type out an API call from memory for a
  library that has shipped a major version in the last ~12 months.

## Secrets

- **No secrets ever committed to git.** `.env` is in `.gitignore`.
  Don't commit `.env.test`, `.env.live`, `.env.local`, or any file
  containing real credentials.
- All environment variables must be documented in `.env.example`
  with a comment explaining what they are.

## Workspace boundaries

- `shared/` is the wire-format authority. Backend and frontend
  import from `story-editor-shared`, never from each other.
- Don't re-export types across lanes to dodge import constraints —
  if a type belongs in `shared/`, put it there.
