# General Rules Digest (cross-cutting)

> **Read by:** `/bd-execute` prepends this file to every implementer
> + task-reviewer dispatch, alongside whatever lane digests
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

## Dependencies

- Install the current stable mainline, not whatever range the LLM
  remembers. Before adding or pinning a package, check `npm view <pkg>
  version`; if a major jump matters (Express 4→5, Vite 5→8, Tiptap
  2→3, Zod 3→4), confirm via `npm view <pkg> versions --json | tail`.
- Pin to the latest stable. An older major needs a reason in the
  commit ("blocked on upstream peer X" + removal trigger), not
  silence — same for an intentional downgrade dodging a known
  regression.
- Applies to `dependencies`, `devDependencies`, `peerDependencies`,
  and tooling pulled in via skill / hook / agent glue.

## External capability lookup

- Before stating — in code, docs, or conversation — that an external
  library or SaaS API has, lacks, or behaves a certain way, **look it
  up first.** Don't infer from our wrappers, our types, prior usage,
  or memory.
- Order: **Context7 MCP** (`resolve-library-id` → `query-docs`; it
  indexes Venice / OpenAI / Anthropic / GitHub API docs as well as
  npm packages), then **WebFetch** the vendor's official docs if
  Context7 is thin.
- **Negative claims are the trap** — "we can't because X doesn't
  support it" workarounds are the most common form of this failure.
  Verify the upstream actually lacks the feature before designing
  around its absence.

## Secrets

- **No secrets ever committed to git.** `.env` is in `.gitignore`.
  Don't commit `.env.test`, `.env.live`, `.env.local`, or any file
  containing real credentials.
- All environment variables must be documented in `.env.example`
  with a comment explaining what they are.

## Workspace boundaries

- `shared/` is the wire-format authority. Backend and frontend
  import from `story-editor-shared`, never from each other.
- `shared/` exports the canonical **Zod schemas** (runtime) alongside
  their inferred wire types and validation constants. Both lanes
  **parse against the schema at the boundary** — backend on egress
  (`respond`), frontend on ingress (`.parse()`). The schemas are
  `z.strictObject`, so an unexpected field throws rather than passing
  silently.
- Don't re-export types across lanes to dodge import constraints —
  if a type belongs in `shared/`, put it there.
