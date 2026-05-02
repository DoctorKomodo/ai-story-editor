> Source of truth: `TASKS.md`. Closed [D]-series tasks archived here on 2026-04-28 to keep `TASKS.md` lean.
> These entries are immutable; any reopen lands as a new task in `TASKS.md`.

---

## 🗄️ D — Database

- [x] **[D1]** Write full Prisma schema in `backend/prisma/schema.prisma`: `User`, `Story`, `Chapter`, `Character`, `RefreshToken`. Correct relations, FK indexes, cascading deletes.
  - verify: `cd backend && npx prisma validate && echo "SCHEMA VALID"`

- [x] **[D2]** `User`: `id` (cuid), `email` (unique), `passwordHash`, `createdAt`, `updatedAt`
  - verify: `cd backend && npx prisma validate && npx prisma db push --force-reset --accept-data-loss 2>&1 | grep -iv error && npm run test:backend -- --run tests/models/user.test.ts`

- [x] **[D3]** `Story`: `id`, `title`, `synopsis`, `genre`, `worldNotes`, `createdAt`, `updatedAt`, `userId` FK. Cascade delete chapters and characters.
  - verify: `cd backend && npm run test:backend -- --run tests/models/story.test.ts`

- [x] **[D4]** `Chapter`: `id`, `title`, `content`, `orderIndex`, `wordCount`, `createdAt`, `updatedAt`, `storyId` FK.
  - verify: `cd backend && npm run test:backend -- --run tests/models/chapter.test.ts`

- [x] **[D5]** `Character`: `id`, `name`, `role`, `physicalDescription`, `personality`, `backstory`, `notes`, `createdAt`, `updatedAt`, `storyId` FK.
  - verify: `cd backend && npm run test:backend -- --run tests/models/character.test.ts`

- [x] **[D6]** `RefreshToken`: `id`, `token` (unique), `userId` FK, `expiresAt`, `createdAt`. Cascade delete when user deleted.
  - verify: `cd backend && npm run test:backend -- --run tests/models/refresh-token.test.ts`

- [x] **[D7]** Run and commit initial migration: `npx prisma migrate dev --name init`.
  - verify: `test -d backend/prisma/migrations && ls backend/prisma/migrations | grep init`

- [x] **[D8]** Write seed script: demo user (`demo@example.com` / `password`), one story, two chapters, two characters.
  - verify: `cd backend && npx ts-node prisma/seed.ts && echo "SEED OK"`

### D — Mockup-driven schema extensions

> Additive to D1–D8 (completed). No column renames or drops — new fields only. Source: `mockups/archive/v1-2025-11/README.md` §Data Model + §Screens.

- [x] **[D9]** Extend `Story` schema with `targetWords Int?` (story progress target, e.g. 90000 — displayed in sidebar footer) and `systemPrompt String?` (per-story creative-writing system prompt; null → prompt builder falls back to default).
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/story-settings.test.ts`

- [x] **[D10]** Extend `Chapter` schema with `bodyJson Json?` (TipTap JSON — canonical going forward) and `status String @default("draft")` (`draft` / `revised` / `final` — drives chapter status chip). Keep existing `content String` as a plain-text mirror derived from `bodyJson` on save so text search and text export keep working.
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/chapter-body-json.test.ts`

- [x] **[D11]** Extend `Character` with mockup-card fields: `age String?`, `appearance String?`, `voice String?`, `arc String?`, `initial String?` (1-char sidebar avatar letter), `color String?` (avatar background hex). Existing `physicalDescription`/`personality`/`backstory`/`notes` are retained; UI may migrate values into the new fields over time.
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/character-mockup.test.ts`

- [x] **[D12]** New model `OutlineItem`: `id`, `storyId` FK (cascade), `order Int`, `title String`, `sub String?`, `status String` (`done` / `current` / `pending`), timestamps. Index on `(storyId, order)`.
  - verify: `cd backend && npm run test:backend -- --run tests/models/outline-item.test.ts`

- [x] **[D13]** New models `Chat` + `Message`. `Chat`: `id`, `chapterId` FK (cascade), `title String?`, timestamps. `Message`: `id`, `chatId` FK (cascade), `role` (`user` / `assistant` / `system`), `contentJson Json`, `attachmentJson Json?` (Ask-AI selection payload: `{ selectionText, chapterId }`), `model String?`, `tokens Int?`, `latencyMs Int?`, `createdAt`. Index on `(chatId, createdAt)`.
  - verify: `cd backend && npm run test:backend -- --run tests/models/chat.test.ts tests/models/message.test.ts`

- [x] **[D14]** Extend `User` with `name String?` (display name shown in top-bar user menu) and `settingsJson Json?` (stores non-sensitive client preferences — theme, prose font, prose size, line height, writing toggles, daily goal, chat model + params).
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/user-profile.test.ts`

- [x] **[D15]** Username-based identity (supersedes email as the primary credential — [D2] completed task remains unchanged; this task adds a new field and relaxes `email`): add `User.username String @unique` (stored lowercase, 3–32 chars, `/^[a-z0-9_-]+$/`). Make `User.email String?` nullable — email becomes optional metadata, not the login identifier. Migration backfills `username` from the local-part of each existing user's email, appending a numeric suffix on collision.
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/user-username.test.ts`

- [x] **[D16]** BYOK Venice-key storage on `User`: add `veniceApiKeyEnc String?` (AES-256-GCM ciphertext, base64), `veniceApiKeyIv String?` (12-byte IV, base64), `veniceApiKeyAuthTag String?` (GCM auth tag, base64), `veniceEndpoint String?` (optional endpoint override, default `https://api.venice.ai/api/v1`). All nullable — users without a stored key cannot invoke AI.
  - verify: `cd backend && npx prisma validate && npm run test:backend -- --run tests/models/user-venice-key.test.ts`

---
