# User Content Backup & Restore (Export / Import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user export all of their own narrative content to one portable plaintext-JSON file and restore (replace-all) from such a file.

**Architecture:** Export = decrypt-on-read through the per-request repos using the caller's session DEK; import = a single transactional wipe-then-recreate that encrypt-on-writes through the repos under the importing user's DEK. No endpoint touches ciphertext, DEKs, or wrap columns. Export/import are "just another authenticated request" — auth, DEK, and CSRF are already provided by existing middleware.

**Tech Stack:** Node/Express/TypeScript, Prisma (interactive `$transaction`), Zod 4 (shared schemas), React + TanStack Query + Vitest/jsdom (frontend).

**Spec:** `docs/superpowers/specs/2026-06-24-user-content-export-import-design.md`

## Global Constraints

Copied verbatim from the spec / CLAUDE.md. Every task's requirements implicitly include this section.

- **TypeScript strict, no `any`** across shared, backend, frontend.
- **All narrative reads go through decrypt and all writes through encrypt, via the repo layer.** No controller/service/route touches Prisma directly for a narrative model (`Story`, `Chapter`, `Character`, `OutlineItem`, `Chat`, `Message`). The **only** raw-Prisma allowed here is the structural wipe `tx.story.deleteMany({ where: { userId } })` (no narrative columns) and the **non-narrative** `prisma.user.findUnique({ select: { username: true } })` for the export filename.
- **No plaintext narrative content in logs, error bodies (outside the owning user's own GET), or any sink.** The import catch site must NOT `console.error` the payload. Plaintext narrative in the export response body is the sanctioned owning-user GET.
- **Cookie-session CSRF posture must hold:** import is a state-changing POST parsed by `express.json()` only (no urlencoded/multipart parser, no method-override). It inherits the global `requireAllowedOrigin` Origin/Referer check (`backend/src/index.ts:95`). No state-changing GET is introduced.
- **Reuse the existing create schemas** for the import shape — one source of truth for field constraints. Imported rows must be exactly as valid as API-created rows.
- **Path-scoped body parser:** the 25mb import parser MUST be mounted at app level on `/api/users/me/import` *before* the global `express.json({ limit: '256kb' })` (`index.ts:89`). The rest of the API keeps the 256kb ceiling.
- **`wordCount` is derived from `bodyJson` on import**, never trusted from the file.
- **Commit format:** `[<bd-id>] brief description`. Commit after each passing verify. Never commit to `main`.
- **Backend tests require the docker stack up** (`make dev`) before running — `vitest globalSetup` unconditionally resets the test DB against Postgres.

---

## File Structure

**Create:**
- `shared/src/schemas/transfer.ts` — `exportSchema`, `importSchema`, `importResultSchema` + inferred types + `EXPORT_FORMAT_VERSION`.
- `backend/src/services/export.service.ts` — `buildExport(req)`: assembles the tree from repos.
- `backend/src/services/import.service.ts` — `runImport(req, file)`: transactional replace-all.
- `backend/src/routes/backup.routes.ts` — `createExportRouter()` + `createImportRouter()`.
- `backend/tests/routes/backup.test.ts` — integration: export shape, round-trip parity, replace-all, rollback, re-sequencing.
- `frontend/src/hooks/useBackup.ts` — `useExportBackup()` (blob download) + `useImportBackup()` mutation.
- `frontend/src/components/SettingsDataTab.tsx` — the "Backup & Restore" tab UI.
- `frontend/src/components/SettingsDataTab.test.tsx` — jsdom tests for the restore flow gating.

**Modify:**
- `shared/src/index.ts` — re-export `./schemas/transfer`.
- `backend/src/services/tiptap-text.ts` — add exported `computeWordCount(bodyJson)`.
- `backend/src/routes/chapters.routes.ts` — import `computeWordCount` from the service (drop the local copy).
- `backend/src/repos/message.repo.ts` — add tx-aware `createWithin(tx, input)`; `create` delegates to it.
- `backend/src/index.ts` — path-scoped 25mb parser before the global parser; mount both routers.
- `frontend/src/lib/api.ts` — add `fetchExportBlob()`.
- `frontend/src/types/settings.ts` — add `'data'` to the `SettingsTab` union.
- `frontend/src/components/Settings.tsx` — add the Data tab to `TABS` and the body switch.

---

## Task 1: Shared transfer schemas

**Files:**
- Create: `shared/src/schemas/transfer.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/schemas/transfer.test.ts`

**Interfaces:**
- Produces: `exportSchema`, `importSchema` (alias of `exportSchema`), `importResultSchema`, types `ExportFile`, `ImportFile`, `ImportResult`, const `EXPORT_FORMAT_VERSION = 1`.
- Consumes: existing `storyCreateSchema` (story.ts), `characterCreateSchema` (character.ts), `outlineCreateSchema` (outline.ts), `chatKindSchema`, `chapterStatusSchema`, `chapterSummarySchema` (chapter.ts), `messageRoleSchema`, `citationSchema`, `messageAttachmentSchema` (message.ts).

- [ ] **Step 1: Write the failing test**

```ts
// shared/src/schemas/transfer.test.ts
import { describe, expect, it } from 'vitest';
import { exportSchema, importSchema, importResultSchema, EXPORT_FORMAT_VERSION } from './transfer';

const minimal = {
  formatVersion: EXPORT_FORMAT_VERSION,
  app: 'inkwell',
  exportedAt: '2026-06-24T12:00:00.000Z',
  stories: [
    {
      title: 'S',
      chapters: [
        { title: 'C', status: 'draft', orderIndex: 0, bodyJson: { type: 'doc', content: [] },
          summary: null, chats: [
            { title: null, kind: 'ask', messages: [
              { role: 'user', content: 'hi', attachmentJson: null, citationsJson: null,
                model: null, tokens: null, latencyMs: null, createdAt: '2026-06-24T12:00:00.000Z' },
            ] },
          ] },
      ],
      characters: [{ name: 'X', orderIndex: 0 }],
      outlineItems: [{ title: 'O', sub: null, status: 'todo', order: 0 }],
    },
  ],
};

describe('transfer schemas', () => {
  it('accepts a well-formed export tree', () => {
    expect(exportSchema.parse(minimal)).toBeTruthy();
  });
  it('rejects an unknown formatVersion', () => {
    expect(exportSchema.safeParse({ ...minimal, formatVersion: 2 }).success).toBe(false);
  });
  it('rejects unknown top-level keys (strict)', () => {
    expect(exportSchema.safeParse({ ...minimal, settings: {} }).success).toBe(false);
  });
  it('importSchema is structurally the export schema', () => {
    expect(importSchema.safeParse(minimal).success).toBe(true);
  });
  it('importResultSchema validates a count summary', () => {
    expect(importResultSchema.parse({
      imported: { stories: 1, chapters: 1, characters: 1, outlineItems: 1, chats: 1, messages: 1 },
    })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix shared run test -- transfer`
Expected: FAIL — `Cannot find module './transfer'`.

- [ ] **Step 3: Write the schemas**

```ts
// shared/src/schemas/transfer.ts
import { z } from 'zod';
import { chapterStatusSchema, chapterSummarySchema } from './chapter';
import { characterCreateSchema } from './character';
import { chatKindSchema } from './chat';
import { citationSchema, messageAttachmentSchema, messageRoleSchema } from './message';
import { outlineCreateSchema } from './outline';
import { storyCreateSchema } from './story';

/** Bump only on a breaking change to the file shape. Import rejects anything else. */
export const EXPORT_FORMAT_VERSION = 1 as const;

const messageExportSchema = z.strictObject({
  role: messageRoleSchema,
  content: z.string(),
  attachmentJson: messageAttachmentSchema.nullable().default(null),
  citationsJson: z.array(citationSchema).nullable().default(null),
  model: z.string().nullable().default(null),
  tokens: z.number().int().nullable().default(null),
  latencyMs: z.number().int().nullable().default(null),
  // Advisory only — import stamps a fresh createdAt (see plan / spec "known lossiness").
  createdAt: z.string().datetime(),
});

const chatExportSchema = z.strictObject({
  title: z.string().nullable().default(null),
  kind: chatKindSchema,
  messages: z.array(messageExportSchema).default([]),
});

const chapterExportSchema = z.strictObject({
  title: z.string().min(1).max(500),
  status: chapterStatusSchema,
  orderIndex: z.number().int().nonnegative(),
  bodyJson: z.unknown().optional(),
  summary: chapterSummarySchema.nullable().default(null),
  chats: z.array(chatExportSchema).default([]),
});

const characterExportSchema = characterCreateSchema.extend({
  orderIndex: z.number().int().nonnegative(),
});

const outlineExportSchema = outlineCreateSchema.extend({
  order: z.number().int().nonnegative(),
});

const storyExportSchema = storyCreateSchema.extend({
  chapters: z.array(chapterExportSchema).default([]),
  characters: z.array(characterExportSchema).default([]),
  outlineItems: z.array(outlineExportSchema).default([]),
});

export const exportSchema = z.strictObject({
  formatVersion: z.literal(EXPORT_FORMAT_VERSION),
  app: z.literal('inkwell'),
  exportedAt: z.string().datetime(),
  stories: z.array(storyExportSchema).default([]),
});
export type ExportFile = z.infer<typeof exportSchema>;

/** Import validates against the same shape; aliased for intent + future divergence. */
export const importSchema = exportSchema;
export type ImportFile = z.infer<typeof importSchema>;

export const importResultSchema = z.strictObject({
  imported: z.strictObject({
    stories: z.number().int().nonnegative(),
    chapters: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative(),
    outlineItems: z.number().int().nonnegative(),
    chats: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
  }),
});
export type ImportResult = z.infer<typeof importResultSchema>;
```

- [ ] **Step 4: Re-export from the barrel**

`shared/src/index.ts` uses explicit named/`export type` blocks per schema (NOT `export * from`). Follow that convention — add:

```ts
export { EXPORT_FORMAT_VERSION, exportSchema, importSchema, importResultSchema } from './schemas/transfer';
export type { ExportFile, ImportFile, ImportResult } from './schemas/transfer';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix shared run test -- transfer && npm --prefix shared run typecheck`
Expected: PASS (5 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add shared/src/schemas/transfer.ts shared/src/schemas/transfer.test.ts shared/src/index.ts
git commit -m "[<bd-id>] shared: export/import transfer schemas"
```

---

## Task 2: Message repo — tx-aware `createWithin`

**Why:** `message.repo.create` wraps its insert + `Chat.lastActivityAt` bump in `client.$transaction` (`message.repo.ts:55`). The import runs inside an outer interactive transaction; calling `create` there would nest `$transaction`, which Prisma forbids and `Prisma.TransactionClient` doesn't type. Extract the body into `createWithin(tx, input)` (no new transaction), and have `create` wrap it. This keeps message encryption inside the repo layer for the import path.

**Files:**
- Modify: `backend/src/repos/message.repo.ts`
- Test: `backend/tests/repos/message.repo.test.ts` (add to the existing file if present; else create)

**Interfaces:**
- Produces: `createMessageRepo(req).createWithin(tx: Prisma.TransactionClient, input: MessageCreateInput): Promise<RepoMessage>`. `create(input)` keeps its existing signature/behaviour.
- Consumes: `MessageCreateInput` (unchanged), `Prisma.TransactionClient` from `@prisma/client`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/repos/message.repo.test.ts  (add this test)
import { Prisma } from '@prisma/client';
import { prisma } from '../setup';
// ... reuse the file's existing register/seed helpers for a chat owned by the user ...

it('createWithin inserts inside an outer transaction without nesting $transaction', async () => {
  const { req, chatId } = await seedChatForUser(); // existing helper pattern
  const created = await prisma.$transaction(async (tx) => {
    const repo = createMessageRepo(req);
    return repo.createWithin(tx as unknown as Prisma.TransactionClient, {
      chatId, role: 'user', content: 'inside tx',
    });
  });
  expect(created.content).toBe('inside tx');
  const back = await createMessageRepo(req).findById(created.id);
  expect(back?.content).toBe('inside tx');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make dev && npm -w story-editor-backend run test -- message.repo`
Expected: FAIL — `repo.createWithin is not a function`.

- [ ] **Step 3: Refactor `create` to delegate to `createWithin`**

In `backend/src/repos/message.repo.ts`: add the `Prisma` type import, widen `ensureChatOwned` to accept a tx client, and split the body:

```ts
import { Prisma, type PrismaClient } from '@prisma/client';
```

```ts
async function ensureChatOwned(
  client: PrismaClient | Prisma.TransactionClient,
  chatId: string,
  userId: string,
): Promise<void> {
  const ok = await client.chat.findFirst({
    where: { id: chatId, chapter: { story: { userId } } },
  });
  if (!ok) throw new Error('message.repo: chat not owned by caller');
}
```

Replace `create` with:

```ts
async function createWithin(tx: Prisma.TransactionClient, input: MessageCreateInput) {
  const userId = resolveUserId(req);
  await ensureChatOwned(tx, input.chatId, userId);
  const created = await tx.message.create({
    data: {
      chatId: input.chatId,
      role: input.role,
      model: input.model ?? null,
      tokens: input.tokens ?? null,
      latencyMs: input.latencyMs ?? null,
      ...writeEncrypted(req, 'content', input.content),
      ...writeEncrypted(req, 'attachmentJson', serialiseJsonField(input.attachmentJson)),
      ...writeEncrypted(req, 'citationsJson', serialiseJsonField(input.citationsJson ?? null)),
    },
  });
  await tx.chat.update({
    where: { id: input.chatId },
    data: { lastActivityAt: new Date() },
    select: { id: true },
  });
  return shape(created, req);
}

async function create(input: MessageCreateInput) {
  return client.$transaction((tx) => createWithin(tx, input));
}
```

Add `createWithin` to the returned object:

```ts
return { create, createWithin, update, findById, findManyForChat, countForChat, deleteAllAfter };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `make dev && npm -w story-editor-backend run test -- message.repo`
Expected: PASS — the new test plus all pre-existing message-repo tests (proving `create` still bumps `lastActivityAt`).

- [ ] **Step 5: Typecheck + commit**

```bash
npm --prefix backend run typecheck
git add backend/src/repos/message.repo.ts backend/tests/repos/message.repo.test.ts
git commit -m "[<bd-id>] message.repo: tx-aware createWithin for transactional import"
```

---

## Task 3: Extract `computeWordCount` to the tiptap-text service

**Why:** Import derives `wordCount` from `bodyJson` using the exact path the chapter routes use. That helper is currently private to `chapters.routes.ts`. Move it next to `tipTapJsonToText` so both call one copy (DRY).

**Files:**
- Modify: `backend/src/services/tiptap-text.ts`
- Modify: `backend/src/routes/chapters.routes.ts`
- Test: `backend/src/services/tiptap-text.test.ts` (add a case; create if absent)

**Interfaces:**
- Produces: `computeWordCount(bodyJson: unknown): number` exported from `tiptap-text.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/services/tiptap-text.test.ts  (add)
import { describe, expect, it } from 'vitest';
import { computeWordCount } from './tiptap-text';

describe('computeWordCount', () => {
  it('counts whitespace-separated words from a TipTap tree', () => {
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'one two three' }] },
    ] };
    expect(computeWordCount(doc)).toBe(3);
  });
  it('returns 0 for empty/absent bodies', () => {
    expect(computeWordCount(null)).toBe(0);
    expect(computeWordCount({ type: 'doc', content: [] })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make dev && npm -w story-editor-backend run test -- tiptap-text`
Expected: FAIL — `computeWordCount` is not exported.

- [ ] **Step 3: Add the export to `tiptap-text.ts`**

```ts
export function computeWordCount(bodyJson: unknown): number {
  const text = tipTapJsonToText(bodyJson).trim();
  if (text.length === 0) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}
```

- [ ] **Step 4: Use it in `chapters.routes.ts`**

Update the import to pull `computeWordCount` from the service and delete the local `function computeWordCount` (`chapters.routes.ts:59-63`):

```ts
import { computeWordCount, tipTapJsonToText } from '../services/tiptap-text';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `make dev && npm -w story-editor-backend run test -- tiptap-text chapters`
Expected: PASS (chapter route tests unaffected — same function, new home).

- [ ] **Step 6: Typecheck + commit**

```bash
npm --prefix backend run typecheck
git add backend/src/services/tiptap-text.ts backend/src/services/tiptap-text.test.ts backend/src/routes/chapters.routes.ts
git commit -m "[<bd-id>] extract computeWordCount to tiptap-text service"
```

---

## Task 4: Export service + `GET /api/users/me/export`

**Files:**
- Create: `backend/src/services/export.service.ts`
- Create: `backend/src/routes/backup.routes.ts` (export router half; import half added in Task 5)
- Modify: `backend/src/index.ts` (mount export router)
- Test: `backend/tests/routes/backup.test.ts`

**Interfaces:**
- Produces: `buildExport(req: Request): Promise<ExportFile>`; `createExportRouter(): Router`.
- Consumes: repo factories (`createStoryRepo`, `createChapterRepo`, `createCharacterRepo`, `createOutlineRepo`, `createChatRepo`, `createMessageRepo`); `exportSchema`, `ExportFile`, `EXPORT_FORMAT_VERSION`; `requireAuth`; `respond`; `prisma` (for the non-narrative username read only).

- [ ] **Step 1: Write the failing test**

```ts
// backend/tests/routes/backup.test.ts
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { sessionCookieName } from '../../src/lib/session-cookie';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

const TEST_ORIGIN = 'http://localhost:3000';

async function registerAndLogin(username: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').set('Origin', TEST_ORIGIN)
    .send({ name: 'U', username, password: 'backup-route-pw' });
  const login = await agent.post('/api/auth/login').set('Origin', TEST_ORIGIN)
    .send({ username, password: 'backup-route-pw' });
  expect(login.status).toBe(200);
  return agent;
}

async function resetAll() {
  _resetSessionStore();
  await prisma.message.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.outlineItem.deleteMany();
  await prisma.character.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.story.deleteMany();
  await prisma.user.deleteMany();
}

describe('GET /api/users/me/export', () => {
  beforeEach(resetAll);
  afterEach(resetAll);

  it('401s without a session', async () => {
    const res = await request(app).get('/api/users/me/export');
    expect(res.status).toBe(401);
  });

  it('returns a valid, decrypted, attachment-dispositioned tree for the caller', async () => {
    const agent = await registerAndLogin('export-user');
    const story = await agent.post('/api/stories').set('Origin', TEST_ORIGIN)
      .send({ title: 'My Story', worldNotes: 'secret lore' });
    await agent.post(`/api/stories/${story.body.story.id}/chapters`).set('Origin', TEST_ORIGIN)
      .send({ title: 'Ch1', bodyJson: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }] } });

    const res = await agent.get('/api/users/me/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="inkwell-backup-export-user-\d{8}\.json"/);
    expect(res.body.formatVersion).toBe(1);
    expect(res.body.stories[0].title).toBe('My Story');
    expect(res.body.stories[0].worldNotes).toBe('secret lore'); // decrypted
    expect(res.body.stories[0].chapters[0].bodyJson.content[0].content[0].text).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make dev && npm -w story-editor-backend run test -- backup`
Expected: FAIL — route 404s (not mounted).

- [ ] **Step 3: Write the export service**

```ts
// backend/src/services/export.service.ts
import type { Request } from 'express';
import { EXPORT_FORMAT_VERSION, type ExportFile } from 'story-editor-shared';
import { createChapterRepo } from '../repos/chapter.repo';
import { createCharacterRepo } from '../repos/character.repo';
import { createChatRepo } from '../repos/chat.repo';
import { createMessageRepo } from '../repos/message.repo';
import { createOutlineRepo } from '../repos/outline.repo';
import { createStoryRepo } from '../repos/story.repo';

export async function buildExport(req: Request): Promise<ExportFile> {
  const storyRepo = createStoryRepo(req);
  const chapterRepo = createChapterRepo(req);
  const characterRepo = createCharacterRepo(req);
  const outlineRepo = createOutlineRepo(req);
  const chatRepo = createChatRepo(req);
  const messageRepo = createMessageRepo(req);

  const stories = await storyRepo.findManyForUser();
  const out: ExportFile['stories'] = [];

  for (const s of stories) {
    const chapterMetas = await chapterRepo.findManyForStory(s.id, { includeSummary: true });
    const chapters: ExportFile['stories'][number]['chapters'] = [];
    for (const meta of chapterMetas) {
      const full = await chapterRepo.findById(meta.id); // body lives only on findById
      const chats: ExportFile['stories'][number]['chapters'][number]['chats'] = [];
      for (const c of await chatRepo.findManyForChapter(meta.id)) {
        const messages = await messageRepo.findManyForChat(c.id);
        chats.push({
          title: c.title ?? null,
          kind: c.kind,
          messages: messages.map((m) => ({
            role: m.role, content: m.content,
            attachmentJson: m.attachmentJson ?? null,
            citationsJson: m.citationsJson ?? null,
            model: m.model ?? null, tokens: m.tokens ?? null, latencyMs: m.latencyMs ?? null,
            createdAt: m.createdAt.toISOString(),
          })),
        });
      }
      chapters.push({
        title: meta.title, status: meta.status, orderIndex: meta.orderIndex,
        bodyJson: full?.bodyJson, summary: meta.summary ?? null, chats,
      });
    }
    const characters = (await characterRepo.findManyForStory(s.id)).map((c) => ({
      name: c.name, role: c.role, age: c.age, appearance: c.appearance,
      personality: c.personality, voice: c.voice, backstory: c.backstory,
      arc: c.arc, relationships: c.relationships, color: c.color, initial: c.initial,
      orderIndex: c.orderIndex,
    }));
    const outlineItems = (await outlineRepo.findManyForStory(s.id)).map((o) => ({
      title: o.title, sub: o.sub ?? null, status: o.status, order: o.order,
    }));
    out.push({
      title: s.title, synopsis: s.synopsis ?? null, genre: s.genre ?? null,
      worldNotes: s.worldNotes ?? null, targetWords: s.targetWords ?? null,
      includePreviousChaptersInPrompt: s.includePreviousChaptersInPrompt,
      chapters, characters, outlineItems,
    });
  }

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    app: 'inkwell',
    exportedAt: new Date().toISOString(),
    stories: out,
  };
}
```

> If any `RepoStory`/`RepoChapterMeta` field name above differs from the actual repo projection (e.g. summary nesting), adjust to the repo's real shape — the repo is the source of truth. Keep every read going through these repo methods.

- [ ] **Step 4: Write the export router**

```ts
// backend/src/routes/backup.routes.ts
import { type Request, type Response, Router } from 'express';
import { exportSchema } from 'story-editor-shared';
import { respond } from '../lib/respond';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth.middleware';
import { buildExport } from '../services/export.service';

function yyyymmdd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function createExportRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req: Request, res: Response, next) => {
    try {
      // username is non-narrative (plaintext) — direct read is allowed for the filename only.
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id }, select: { username: true },
      });
      const file = await buildExport(req);
      const name = `inkwell-backup-${user?.username ?? 'user'}-${yyyymmdd(new Date())}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      return respond(exportSchema, res, file);
    } catch (err) {
      next(err);
    }
  });
  return router;
}
```

- [ ] **Step 5: Mount it in `index.ts`**

Add alongside the other `/api/users/me/*` mounts (after `createUserSettingsRouter`):

```ts
import { createExportRouter } from './routes/backup.routes';
// ...
app.use('/api/users/me/export', createExportRouter());
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `make dev && npm -w story-editor-backend run test -- backup`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck + commit**

```bash
npm --prefix backend run typecheck
git add backend/src/services/export.service.ts backend/src/routes/backup.routes.ts backend/src/index.ts backend/tests/routes/backup.test.ts
git commit -m "[<bd-id>] backend: GET /api/users/me/export"
```

---

## Task 5: Import service + `POST /api/users/me/import` (transactional replace-all)

**Files:**
- Create: `backend/src/services/import.service.ts`
- Modify: `backend/src/routes/backup.routes.ts` (add `createImportRouter`)
- Modify: `backend/src/index.ts` (path-scoped 25mb parser before global; mount import router)
- Test: `backend/tests/routes/backup.test.ts` (add the import cases + round-trip parity)

**Interfaces:**
- Produces: `runImport(req: Request, file: ImportFile): Promise<ImportResult>`; `createImportRouter(): Router`.
- Consumes: `prisma` (for `tx.story.deleteMany` wipe only); repo factories; `createMessageRepo(req).createWithin` (Task 2); `computeWordCount` (Task 3); `importSchema`, `importResultSchema`, `ImportFile`, `ImportResult`; `validateBody`; rate-limit pattern from `auth.routes.ts:57`.

- [ ] **Step 1: Write the failing tests**

```ts
// add to backend/tests/routes/backup.test.ts
describe('POST /api/users/me/import', () => {
  beforeEach(resetAll);
  afterEach(resetAll);

  it('401s without a session', async () => {
    const res = await request(app).post('/api/users/me/import').set('Origin', TEST_ORIGIN).send({});
    expect(res.status).toBe(401);
  });

  it('replace-all: wipes existing content and recreates from the file (round-trip parity)', async () => {
    const agent = await registerAndLogin('import-user');
    // seed initial content, export it
    const story = await agent.post('/api/stories').set('Origin', TEST_ORIGIN)
      .send({ title: 'Original', worldNotes: 'lore-A' });
    await agent.post(`/api/stories/${story.body.story.id}/chapters`).set('Origin', TEST_ORIGIN)
      .send({ title: 'Ch1', bodyJson: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'alpha beta' }] }] } });
    const firstExport = (await agent.get('/api/users/me/export')).body;

    // mutate: add a second story that must be gone after restore
    await agent.post('/api/stories').set('Origin', TEST_ORIGIN).send({ title: 'TO BE DELETED' });

    const imp = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send(firstExport);
    expect(imp.status).toBe(200);
    expect(imp.body.imported.stories).toBe(1);
    expect(imp.body.imported.chapters).toBe(1);

    const secondExport = (await agent.get('/api/users/me/export')).body;
    expect(secondExport.stories.map((s: { title: string }) => s.title)).toEqual(['Original']);
    expect(secondExport.stories[0].worldNotes).toBe('lore-A');
    // parity modulo exportedAt (export omits ids/timestamps/wordCount by design)
    expect({ ...secondExport, exportedAt: 0 }).toEqual({ ...firstExport, exportedAt: 0 });
  });

  it('re-sequences orderIndex/order from a gappy file', async () => {
    const agent = await registerAndLogin('seq-user');
    const file = {
      formatVersion: 1, app: 'inkwell', exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [{ title: 'S',
        chapters: [
          { title: 'B', status: 'draft', orderIndex: 7, bodyJson: { type: 'doc', content: [] }, summary: null, chats: [] },
          { title: 'A', status: 'draft', orderIndex: 2, bodyJson: { type: 'doc', content: [] }, summary: null, chats: [] },
        ],
        characters: [], outlineItems: [] }],
    };
    const imp = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send(file);
    expect(imp.status).toBe(200);
    const out = (await agent.get('/api/users/me/export')).body;
    expect(out.stories[0].chapters.map((c: { title: string; orderIndex: number }) => [c.title, c.orderIndex]))
      .toEqual([['A', 0], ['B', 1]]);
  });

  it('round-trips includePreviousChaptersInPrompt = false', async () => {
    // Regression guard for the create()-ignores-the-flag bug. The generic parity
    // test seeds via POST (which can't set the flag), so it would mask this.
    const agent = await registerAndLogin('flag-user');
    const story = await agent.post('/api/stories').set('Origin', TEST_ORIGIN).send({ title: 'Flagged' });
    await agent.patch(`/api/stories/${story.body.story.id}`).set('Origin', TEST_ORIGIN)
      .send({ includePreviousChaptersInPrompt: false });
    const exp = (await agent.get('/api/users/me/export')).body;
    expect(exp.stories[0].includePreviousChaptersInPrompt).toBe(false);

    await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send(exp);
    const exp2 = (await agent.get('/api/users/me/export')).body;
    expect(exp2.stories[0].includePreviousChaptersInPrompt).toBe(false);
  });

  it('rejects an unknown formatVersion with 400', async () => {
    const agent = await registerAndLogin('badver-user');
    const res = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN)
      .send({ formatVersion: 99, app: 'inkwell', exportedAt: '2026-06-24T12:00:00.000Z', stories: [] });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make dev && npm -w story-editor-backend run test -- backup`
Expected: FAIL — import route 404s.

- [ ] **Step 3: Write the import service**

```ts
// backend/src/services/import.service.ts
import { type PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type { ImportFile, ImportResult } from 'story-editor-shared';
import { prisma } from '../lib/prisma';
import { createChapterRepo } from '../repos/chapter.repo';
import { createCharacterRepo } from '../repos/character.repo';
import { createChatRepo } from '../repos/chat.repo';
import { createMessageRepo } from '../repos/message.repo';
import { createOutlineRepo } from '../repos/outline.repo';
import { createStoryRepo } from '../repos/story.repo';
import { computeWordCount } from './tiptap-text';

export async function runImport(req: Request, file: ImportFile): Promise<ImportResult> {
  const userId = req.user!.id;
  const counts = { stories: 0, chapters: 0, characters: 0, outlineItems: 0, chats: 0, messages: 0 };

  await prisma.$transaction(
    async (tx) => {
      // Structural wipe (no narrative columns); cascade removes the whole subtree.
      await tx.story.deleteMany({ where: { userId } });

      // The create() methods used below never open their own $transaction, so the tx
      // client stands in for PrismaClient at runtime. Messages use the tx-aware
      // createWithin (their create() *does* self-transact). One documented bridge cast:
      const txc = tx as unknown as PrismaClient;
      const storyRepo = createStoryRepo(req, txc);
      const chapterRepo = createChapterRepo(req, txc);
      const characterRepo = createCharacterRepo(req, txc);
      const outlineRepo = createOutlineRepo(req, txc);
      const chatRepo = createChatRepo(req, txc);
      const messageRepo = createMessageRepo(req);

      for (const s of file.stories) {
        const story = await storyRepo.create({
          title: s.title, synopsis: s.synopsis ?? null, genre: s.genre ?? null,
          worldNotes: s.worldNotes ?? null, targetWords: s.targetWords ?? null,
        });
        counts.stories++;
        // storyRepo.create() does NOT write includePreviousChaptersInPrompt — the
        // column has @default(true) (schema.prisma) and create ignores the field.
        // Set it explicitly via update() so the flag round-trips faithfully
        // (export emits the real value; without this a `false` would import as `true`).
        if (typeof s.includePreviousChaptersInPrompt === 'boolean') {
          await storyRepo.update(story.id, {
            includePreviousChaptersInPrompt: s.includePreviousChaptersInPrompt,
          });
        }

        const chapters = [...s.chapters].sort((a, b) => a.orderIndex - b.orderIndex);
        for (let i = 0; i < chapters.length; i++) {
          const ch = chapters[i];
          const created = await chapterRepo.create({
            storyId: story.id, title: ch.title, bodyJson: ch.bodyJson,
            status: ch.status, orderIndex: i, wordCount: computeWordCount(ch.bodyJson),
          });
          counts.chapters++;
          if (ch.summary) await chapterRepo.update(created.id, { summaryJson: ch.summary });
          for (const c of ch.chats) {
            const chat = await chatRepo.create({ chapterId: created.id, title: c.title ?? null, kind: c.kind });
            counts.chats++;
            for (const m of c.messages) {
              await messageRepo.createWithin(tx, {
                chatId: chat.id, role: m.role, content: m.content,
                attachmentJson: m.attachmentJson, citationsJson: m.citationsJson,
                model: m.model, tokens: m.tokens, latencyMs: m.latencyMs,
              });
              counts.messages++;
            }
          }
        }

        const chars = [...s.characters].sort((a, b) => a.orderIndex - b.orderIndex);
        for (let i = 0; i < chars.length; i++) {
          const c = chars[i];
          await characterRepo.create({
            storyId: story.id, orderIndex: i, name: c.name, role: c.role, age: c.age,
            appearance: c.appearance, personality: c.personality, voice: c.voice,
            backstory: c.backstory, arc: c.arc, relationships: c.relationships,
            color: c.color, initial: c.initial,
          });
          counts.characters++;
        }

        const items = [...s.outlineItems].sort((a, b) => a.order - b.order);
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          await outlineRepo.create({ storyId: story.id, order: i, title: it.title, sub: it.sub ?? null, status: it.status });
          counts.outlineItems++;
        }
      }
    },
    { maxWait: 5_000, timeout: 120_000 },
  );

  return { imported: counts };
}
```

- [ ] **Step 4: Add the import router half to `backup.routes.ts`**

```ts
import rateLimit from 'express-rate-limit';
import { ipKeyGenerator } from 'express-rate-limit';
import { importResultSchema, importSchema } from 'story-editor-shared';
import { validateBody } from '../middleware/validate';
import { runImport } from '../services/import.service';

const importLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

export function createImportRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(importLimiter);
  router.post('/', validateBody(importSchema, async (body, req, res) => {
    const result = await runImport(req, body);
    return respond(importResultSchema, res, result);
  }));
  return router;
}
```

- [ ] **Step 5: Wire `index.ts` — path-scoped parser BEFORE the global parser, then mount**

Immediately **before** `app.use(express.json({ limit: '256kb' }));` (`index.ts:89`):

```ts
// Whole-account import carries every chapter/chat/message at once. A path-scoped
// 25mb parser must run BEFORE the global 256kb parser so it sets req._body first
// (the global parser then skips). A larger parser mounted after would never run —
// the 256kb parser would already 413 the body. Still JSON-only → cookie CSRF posture holds.
app.use('/api/users/me/import', express.json({ limit: '25mb' }));
```

And with the other mounts:

```ts
import { createExportRouter, createImportRouter } from './routes/backup.routes';
// ...
app.use('/api/users/me/import', createImportRouter());
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `make dev && npm -w story-editor-backend run test -- backup`
Expected: PASS (all export + import cases, including round-trip parity and re-sequencing).

- [ ] **Step 7: Typecheck + commit**

```bash
npm --prefix backend run typecheck
git add backend/src/services/import.service.ts backend/src/routes/backup.routes.ts backend/src/index.ts backend/tests/routes/backup.test.ts
git commit -m "[<bd-id>] backend: POST /api/users/me/import (transactional replace-all)"
```

---

## Task 6: Frontend API + hooks

**Files:**
- Modify: `frontend/src/lib/api.ts` (add `fetchExportBlob`)
- Create: `frontend/src/hooks/useBackup.ts`
- Test: `frontend/src/hooks/useBackup.test.ts`

**Interfaces:**
- Produces: `fetchExportBlob(): Promise<{ blob: Blob; filename: string }>` (api.ts); `useExportBackup()` → `{ download: () => Promise<void>; isPending }`; `useImportBackup()` → TanStack `useMutation` posting an `ImportFile` to `/users/me/import` and invalidating all queries on success.
- Consumes: `api`, `buildUrl`/`resolveBaseUrl` (in-module), `ImportFile`/`ImportResult`/`importSchema` from shared, `useQueryClient`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/hooks/useBackup.test.ts
import { describe, expect, it, vi } from 'vitest';
import { triggerDownload } from './useBackup';

describe('triggerDownload', () => {
  it('creates an object URL and clicks an anchor with the filename', () => {
    const click = vi.fn();
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    triggerDownload(new Blob(['{}']), 'inkwell-backup.json');
    expect(createURL).toHaveBeenCalled();
    expect(anchor.download).toBe('inkwell-backup.json');
    expect(click).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test -- useBackup`
Expected: FAIL — `Cannot find module './useBackup'`.

- [ ] **Step 3: Add `fetchExportBlob` to api.ts**

Inside `frontend/src/lib/api.ts` (where `buildUrl` is in scope):

```ts
export async function fetchExportBlob(): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(buildUrl('/users/me/export'), { credentials: 'include' });
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, 'Export failed');
  }
  const cd = res.headers.get('Content-Disposition') ?? '';
  const match = cd.match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match?.[1] ?? 'inkwell-backup.json' };
}
```

- [ ] **Step 4: Write the hooks**

```ts
// frontend/src/hooks/useBackup.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { type ImportFile, type ImportResult } from 'story-editor-shared';
import { api, fetchExportBlob } from '@/lib/api';

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function useExportBackup() {
  const [isPending, setPending] = useState(false);
  async function download() {
    setPending(true);
    try {
      const { blob, filename } = await fetchExportBlob();
      triggerDownload(blob, filename);
    } finally {
      setPending(false);
    }
  }
  return { download, isPending };
}

export function useImportBackup() {
  const qc = useQueryClient();
  return useMutation<ImportResult, Error, ImportFile>({
    mutationFn: (file) => api<ImportResult>('/users/me/import', { method: 'POST', body: file }),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix frontend run test -- useBackup && npm --prefix frontend run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/useBackup.ts frontend/src/hooks/useBackup.test.ts
git commit -m "[<bd-id>] frontend: export/import api + hooks"
```

---

## Task 7: Frontend "Backup & Restore" settings tab

**Files:**
- Modify: `frontend/src/types/settings.ts` (add `'data'`)
- Modify: `frontend/src/components/Settings.tsx` (TABS entry + body switch)
- Create: `frontend/src/components/SettingsDataTab.tsx`
- Test: `frontend/src/components/SettingsDataTab.test.tsx`

**Interfaces:**
- Consumes: `useExportBackup`, `useImportBackup` (Task 6); `importSchema` (client-side validation); design primitives already used by sibling tabs.

**Restore flow (spec §Frontend):** file picker → `JSON.parse` → client-side `importSchema.safeParse` → show summary (N stories/chapters/…) and a "this deletes everything" warning → **auto-download a fresh export as the safety net** (`useExportBackup().download()`) → require typing the exact phrase `replace everything` to enable the Restore button → POST → on success the mutation invalidates all queries.

- [ ] **Step 1: Write the failing test (the destructive-gate is the highest-value assertion)**

```tsx
// frontend/src/components/SettingsDataTab.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsDataTab } from './SettingsDataTab';

function renderTab() {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><SettingsDataTab /></QueryClientProvider>);
}

describe('SettingsDataTab', () => {
  it('disables Restore until the confirmation phrase is typed', () => {
    renderTab();
    const restore = screen.getByRole('button', { name: /restore/i });
    expect(restore).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/type .*replace everything/i), {
      target: { value: 'replace everything' },
    });
    // still disabled until a valid file is staged
    expect(restore).toBeDisabled();
  });

  it('renders an Export button', () => {
    renderTab();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test -- SettingsDataTab`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `'data'` to the SettingsTab union**

In `frontend/src/types/settings.ts`, add `'data'` to the `SettingsTab` string-literal union.

- [ ] **Step 4: Build `SettingsDataTab.tsx`**

```tsx
// frontend/src/components/SettingsDataTab.tsx
import { type JSX, useRef, useState } from 'react';
import { importSchema, type ImportFile } from 'story-editor-shared';
import { useExportBackup, useImportBackup } from '@/hooks/useBackup';

const CONFIRM_PHRASE = 'replace everything';

export function SettingsDataTab(): JSX.Element {
  const exporter = useExportBackup();
  const importer = useImportBackup();
  const [staged, setStaged] = useState<ImportFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null); setStaged(null);
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const parsed = importSchema.safeParse(JSON.parse(await f.text()));
      if (!parsed.success) { setError('That file is not a valid Inkwell backup.'); return; }
      setStaged(parsed.data);
    } catch { setError('Could not read that file as JSON.'); }
  }

  async function onRestore() {
    if (!staged) return;
    await exporter.download();          // safety net: auto-download current account first
    await importer.mutateAsync(staged); // replace-all
    setStaged(null); setPhrase('');
  }

  const canRestore = staged !== null && phrase === CONFIRM_PHRASE && !importer.isPending;
  const counts = staged && {
    stories: staged.stories.length,
    chapters: staged.stories.reduce((n, s) => n + s.chapters.length, 0),
  };

  return (
    <div>
      <section>
        <h3>Export</h3>
        <button type="button" onClick={() => void exporter.download()} disabled={exporter.isPending}>
          {exporter.isPending ? 'Exporting…' : 'Export my content'}
        </button>
      </section>
      <section>
        <h3>Restore (replaces everything)</h3>
        <input ref={fileRef} type="file" accept="application/json" onChange={onFile} />
        {error && <p role="alert">{error}</p>}
        {counts && <p>This file contains {counts.stories} stories and {counts.chapters} chapters. Restoring deletes all current content first.</p>}
        <label>
          Type "<code>{CONFIRM_PHRASE}</code>" to confirm
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} />
        </label>
        <button type="button" onClick={() => void onRestore()} disabled={!canRestore}>
          {importer.isPending ? 'Restoring…' : 'Restore'}
        </button>
      </section>
    </div>
  );
}
```

> Style with the same design primitives/tokens as the sibling tabs (`SettingsWritingTab` is the closest template). The markup above is functional, not final chrome — match the existing tab look and the `lint:design` token rules.

- [ ] **Step 5: Wire the tab into `Settings.tsx`**

The component is `SettingsModal` (exported from `Settings.tsx`). Add `{ id: 'data', label: 'Backup' }` to the `TABS` array and import `SettingsDataTab`.

The body is a nested ternary whose **final `else` renders `SettingsAppearanceTab` unconditionally** (it assumes `activeTab === 'appearance'` rather than testing it). Don't let Data fall through that tail — convert the tail to an explicit check so each tab is selected by id, e.g.:

```tsx
) : activeTab === 'appearance' ? (
  <SettingsAppearanceTab />
) : (
  <SettingsDataTab />
)}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --prefix frontend run test -- SettingsDataTab && npm --prefix frontend run typecheck && npm --prefix frontend run lint:design`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/settings.ts frontend/src/components/Settings.tsx frontend/src/components/SettingsDataTab.tsx frontend/src/components/SettingsDataTab.test.tsx
git commit -m "[<bd-id>] frontend: Backup & Restore settings tab"
```

---

## Final verification

- [ ] **Full gate:** `make dev && make verify` (lint + typecheck + design-lint + builds + shared/backend/frontend tests).
- [ ] **Security surface:** `backup.routes.ts` + `import.service.ts` touch the `/api/users/me/*` auth surface and emit full plaintext content — expect `security-reviewer` via `/bd-close-reviewed`. Confirm: export caller-scoped via `req.user.id` (never a body-supplied id); import never logs the payload; the import error path does not `console.error` the body.
- [ ] **Repo boundary:** every narrative read/write goes through repos; only `tx.story.deleteMany` (structural, userId-scoped) and the non-narrative `prisma.user.findUnique({ select: { username } })` use raw Prisma — expect `repo-boundary-reviewer`.
- [ ] **Leak test [E12]:** unaffected — re-run as part of the backend suite.

## Open item for implementation (from spec)

- **Transaction `timeout`/`maxWait`.** The plan sets `{ maxWait: 5_000, timeout: 120_000 }`. If a very large account still trips the timeout, raise `timeout` or batch inserts inside the tx. Tune against a realistic large-account fixture during Task 5.
