# Superpowers Digest-Injection Spike — Memo

**Status:** Phase 0 gate of `docs/multi-agent-workflow-plan.md` — closed.
**Date:** 2026-05-06.
**Outcome:** Mechanism proven; Phase 1 may proceed.

---

## Question

The multi-agent plan rests on the load-bearing assumption that
project-rule digests (`docs/agent-rules/*.md`) can be injected into
the *effective prompts* of subagents dispatched by superpowers'
`subagent-driven-development` skill — without forking the skill or
its prompt templates. Three candidate mechanisms were named:

- **(a)** A skill-config injection point (e.g. a `.superpowers-config.json`
  declaring "prepend file X to `implementer-prompt.md`").
- **(b)** A skill argument or parameter passed at invocation that augments
  the implementer / code-quality-reviewer prompts.
- **(c)** Neither — the bridge skill must drive its own dispatch loop using
  superpowers' prompt-template files as content.

Phase 0's job: read the skill source, decide which is viable, prove it
end-to-end with a sentinel, and accept the tradeoffs.

---

## Source read

Examined: `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/subagent-driven-development/`

- `SKILL.md` — describes the per-task loop (implementer → spec reviewer
  → code-quality reviewer) executed by the **controlling agent**, i.e.
  the main session that invokes the skill via the `Skill` tool.
- `implementer-prompt.md` — a markdown **template** with placeholder
  fields (`[FULL TEXT of task from plan - paste it here]`,
  `[Scene-setting...]`, `Work from: [directory]`). It is *content*
  read by the controller, not a runtime hook.
- `spec-reviewer-prompt.md`, `code-quality-reviewer-prompt.md` — same
  shape: templates the controller fills in.

The Skill tool loads `SKILL.md` into the controlling agent's context.
The controller then **constructs the `Task` prompt itself** from the
template + task-specific text, and calls the agent dispatch tool. No
config file is consulted; no parameters are accepted; nothing in the
plugin auto-prepends or transforms the prompt.

## Mechanism decision

| Candidate | Viable? | Why |
|---|---|---|
| **(a)** skill-config injection point | **No** | No config file is referenced anywhere in `SKILL.md` or the prompt templates. The skill is pure prose-as-instructions; there is no machinery to read a config. |
| **(b)** skill argument / parameter | **No** | The `Skill` tool accepts an optional free-form `args` string, but `subagent-driven-development` does not parse or thread args anywhere. No parameters reach the dispatched subagents. |
| **(c)** bridge-driven dispatch using templates as content | **Yes** | The controller is *already* the one composing the dispatched prompt. Adding a `## Project Rules` section sourced from a digest file is one extra step in that composition — no plugin code or template files need to change. |

**(c) is forced — and that is fine.** The plan flagged (c) as the
"abandon-the-digest-mechanism-or-fork" fallback, but the read shows
this characterisation was too pessimistic. The bridge skill does not
need to **fork** anything. It simply tells the controlling main
session: "When you build the implementer / code-quality-reviewer
prompt, prepend the matching digest from `docs/agent-rules/` as a
labelled `## Project Rules` section before the `## Task Description`
block." The plugin's templates remain authoritative and unmodified;
the bridge composes around them.

This is **(c) under the kindest interpretation** — bridge-driven
composition, with the plugin's templates re-read fresh on each
dispatch (so plugin upgrades roll forward automatically). It is *not*
a fork-by-copy.

## Proof-of-concept

A no-op dispatch was run end-to-end to confirm digest content reaches
the implementer's effective prompt.

**Setup**
- Sentinel-bearing digest written to `/tmp/spike-poc/digest-backend.md`
  containing `RULES-DIGEST-SENTINEL-XYZZY` plus a short sample rule.
- Sacrificial Agent dispatched (general-purpose subagent type) with
  the digest contents prepended as a `## Project Rules (prepended by
  bridge skill from docs/agent-rules/backend.md)` section *above* the
  `## Task Description` block, mirroring `implementer-prompt.md`'s
  structure.
- Task assigned to the agent: inspect its prompt, report whether the
  sentinel and a representative rule-phrase are visible. No code
  written, no shell run, no commit.

**Result**
- `Sentinel RULES-DIGEST-SENTINEL-XYZZY visible in prompt:` **yes**
- `Phrase "repo layer — never call Prisma directly" visible in prompt:`
  **yes**
- Subagent correctly identified the prepended section by header
  ("Backend Rules Digest (POC sentinel-bearing test fixture)") — the
  digest reached its context with structure intact, not as flattened
  noise.

The mechanism works. The bridge skill's job is straightforward: read
plan touch-set → consult `docs/agent-rules/index.md` → load matching
digest → prepend to the dispatched Task prompt under a labelled
section.

## Tradeoffs accepted

Going with (c) means:

1. **The bridge owns the prompt-composition step.** If superpowers
   ships a major rewrite of `implementer-prompt.md` placeholder names
   in a future plugin version, the bridge skill's instructions need
   a corresponding update. Mitigation: the bridge instructs the
   controlling main session to *read* `implementer-prompt.md` fresh
   on each dispatch (rather than baking a copy of the template into
   the bridge), so structural updates flow through. The bridge owns
   only the addition of the `## Project Rules` section — a small
   surface area.
2. **Digest content is part of every dispatched prompt.** Token cost
   per dispatch grows by ~the size of the matching digest(s).
   `docs/agent-rules/backend.md` and `frontend.md` are expected to
   be ≲ 200 lines each; the cost is modest and bounded. No mitigation
   needed at Phase 1 scale.
3. **Path-glob → digest mapping must be honoured by the bridge.** The
   bridge consults `docs/agent-rules/index.md` itself; the controller
   doesn't auto-resolve. This is by design — see Phase 1 spec — but
   means the index file must stay accurate.

None of these is a deal-breaker. (c) under the bridge-composition
interpretation costs essentially nothing more than (a) or (b) would
have, and avoids depending on machinery the plugin does not
currently expose.

## Recommendation

Proceed to Phase 1 with the bridge skill (`/bd-execute`) implementing
the bridge-driven composition pattern:

1. `bd update <id> --claim`
2. Read plan link from bd notes; read plan; extract touch-set.
3. Consult `docs/agent-rules/index.md`; pick matching digest(s).
4. Read `~/.claude/plugins/.../subagent-driven-development/
   implementer-prompt.md` (and the two reviewer templates) fresh.
5. For each Task dispatch: prepend
   ```
   ## Project Rules (from docs/agent-rules/<name>.md)

   <digest content>
   ```
   above the `## Task Description` section, then dispatch.
6. After loop CLEAN: invoke `/bd-close-reviewed <id>`.

The injection point is verified. Phase 1 is unblocked.

## Cleanup

The scratch fixture at `/tmp/spike-poc/digest-backend.md` is local to
this machine and will be removed; no fixture is committed.
