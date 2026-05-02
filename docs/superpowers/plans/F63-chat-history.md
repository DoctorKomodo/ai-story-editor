# [F63] Chat History Pane — Plan Deferred

**Status:** Awaiting design mockup from the project owner.

The user wants to drive the design of the chat history pane themselves before an implementation plan is written. The F-series header rule for `[design-first]` tasks already requires a mockup committed to `mockups/archive/v1-2025-11/design/` before code starts, so this plan is intentionally not drafted yet.

When the mockup lands, the plan should:
- Reference the committed mockup file(s) under `mockups/archive/v1-2025-11/design/`.
- Use `useChatsQuery(chapterId)` (already shipped) for the list source.
- Define what "New chat" does to the previous one and the archive/pin/delete semantics — both are open per the task copy.
- Replace the placeholder string in the F38 History tab body with the real list UI.

Verify command (unchanged from `TASKS.md`):
```bash
cd frontend && npm run test:frontend -- --run tests/components/ChatHistory.test.tsx
```

Resume planning here once the mockup is in.
