import path from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lit, makeMigrationHarness } from './_harness';

// [story-editor-9wk.9] Migration-squash harness. Validates the consolidated
// pre-9wk → post-9wk drafts migration against a POPULATED pre-9wk database,
// applied exactly the way an operator upgrade applies it (prisma migrate
// deploy). Opt-in: excluded from the default suite; run via
// `npm run test:migration-squash` with the compose stack up.
//
// Security posture: no DEK, no decryption, no plaintext narrative content.
// Every "ciphertext" below is an arbitrary marker string — the migration
// relocates bytes without decrypting, so byte-identity is the property under
// test.

const { migrateDeploy, setup, teardown } = makeMigrationHarness({
  scratchDb: 'storyeditor_squash_test',
  fixture: path.join(__dirname, 'fixtures', 'pre-9wk-baseline.sql'),
});

// ---- seed data (pre-9wk shapes; raw SQL — the current Prisma client no
// ---- longer knows these columns, by design) --------------------------------

interface ChapterSeed {
  storyId: string;
  orderIndex: number;
  body: [string, string, string] | null; // [ciphertext, iv, authTag]
  summary: [string, string, string] | null;
  summaryUpdatedAt: string | null; // 'YYYY-MM-DD HH:MM:SS' (timestamp literal)
  wordCount: number;
}

const CHAPTER_UPDATED_AT = '2026-06-15 12:00:00';

const CHAPTERS: Record<string, ChapterSeed> = {
  'ch-1': {
    storyId: 's-1',
    orderIndex: 0,
    body: ['ct:body:ch-1', 'iv:body:ch-1', 'tag:body:ch-1'],
    summary: ['ct:sum:ch-1', 'iv:sum:ch-1', 'tag:sum:ch-1'],
    summaryUpdatedAt: '2026-06-01 10:00:00',
    wordCount: 123,
  },
  'ch-2': {
    storyId: 's-1',
    orderIndex: 1,
    body: ['ct:body:ch-2', 'iv:body:ch-2', 'tag:body:ch-2'],
    summary: null,
    summaryUpdatedAt: null,
    wordCount: 45,
  },
  // Never-written chapter: NULL body, wordCount 0 — the backfill must still
  // mint its draft and point activeDraftId at it.
  'ch-3': {
    storyId: 's-2',
    orderIndex: 0,
    body: null,
    summary: null,
    summaryUpdatedAt: null,
    wordCount: 0,
  },
  'ch-4': {
    storyId: 's-2',
    orderIndex: 1,
    body: ['ct:body:ch-4', 'iv:body:ch-4', 'tag:body:ch-4'],
    summary: null,
    summaryUpdatedAt: null,
    wordCount: 7,
  },
};

const CHATS: Record<string, { chapterId: string; kind: 'ask' | 'scene' }> = {
  'chat-1': { chapterId: 'ch-1', kind: 'ask' },
  'chat-2': { chapterId: 'ch-4', kind: 'ask' },
  'chat-3': { chapterId: 'ch-4', kind: 'scene' },
};

const MESSAGES: Record<string, { chatId: string; role: string; content: string }> = {
  'msg-1': { chatId: 'chat-1', role: 'user', content: 'ct:msg-1' },
  'msg-2': { chatId: 'chat-1', role: 'assistant', content: 'ct:msg-2' },
  'msg-3': { chatId: 'chat-3', role: 'user', content: 'ct:msg-3' },
};

function seedSql(): string {
  const stmts: string[] = [];
  stmts.push(
    `INSERT INTO "User" ("id","username","passwordHash","updatedAt") VALUES
      ('u-1','squash-user-1','not-a-real-hash','2026-06-01 00:00:00'),
      ('u-2','squash-user-2','not-a-real-hash','2026-06-01 00:00:00');`,
    `INSERT INTO "Story" ("id","userId","titleCiphertext","titleIv","titleAuthTag","updatedAt") VALUES
      ('s-1','u-1','ct:title:s-1','iv:title:s-1','tag:title:s-1','2026-06-01 00:00:00'),
      ('s-2','u-2','ct:title:s-2','iv:title:s-2','tag:title:s-2','2026-06-01 00:00:00');`,
  );
  for (const [id, c] of Object.entries(CHAPTERS)) {
    stmts.push(`INSERT INTO "Chapter"
      ("id","storyId","orderIndex","titleCiphertext","titleIv","titleAuthTag",
       "bodyCiphertext","bodyIv","bodyAuthTag",
       "summaryJsonCiphertext","summaryJsonIv","summaryJsonAuthTag","summaryJsonUpdatedAt",
       "wordCount","updatedAt")
      VALUES (${lit(id)},${lit(c.storyId)},${c.orderIndex},
        ${lit(`ct:title:${id}`)},${lit(`iv:title:${id}`)},${lit(`tag:title:${id}`)},
        ${lit(c.body?.[0] ?? null)},${lit(c.body?.[1] ?? null)},${lit(c.body?.[2] ?? null)},
        ${lit(c.summary?.[0] ?? null)},${lit(c.summary?.[1] ?? null)},${lit(c.summary?.[2] ?? null)},
        ${lit(c.summaryUpdatedAt)},
        ${c.wordCount},${lit(CHAPTER_UPDATED_AT)});`);
  }
  for (const [id, ch] of Object.entries(CHATS)) {
    stmts.push(`INSERT INTO "Chat"
      ("id","chapterId","kind","titleCiphertext","titleIv","titleAuthTag","updatedAt")
      VALUES (${lit(id)},${lit(ch.chapterId)},${lit(ch.kind)},
        ${lit(`ct:chat:${id}`)},${lit(`iv:chat:${id}`)},${lit(`tag:chat:${id}`)},
        '2026-06-01 00:00:00');`);
  }
  for (const [id, m] of Object.entries(MESSAGES)) {
    stmts.push(`INSERT INTO "Message"
      ("id","chatId","role","contentCiphertext","contentIv","contentAuthTag")
      VALUES (${lit(id)},${lit(m.chatId)},${lit(m.role)},
        ${lit(m.content)},${lit(`iv:${id}`)},${lit(`tag:${id}`)});`);
  }
  return stmts.join('\n');
}

// ---- harness ----------------------------------------------------------------

let scratch: Client;
let firstDeployOutput = '';

describe('[9wk.9] consolidated drafts migration on populated pre-9wk data', () => {
  beforeAll(async () => {
    scratch = await setup();
    await scratch.query(seedSql());

    firstDeployOutput = migrateDeploy();
  });

  afterAll(async () => {
    await teardown(scratch);
  });

  it('deploy applied exactly the consolidated migration', () => {
    expect(firstDeployOutput).toMatch(/\d{14}_drafts/);
    expect(firstDeployOutput).not.toMatch(
      /drafts_expand|drafts_contract|drafts_resync|chat_draft_fk/,
    );
  });

  it('creates exactly one draft per chapter with byte-identical content', async () => {
    const res = await scratch.query(`
      SELECT "chapterId","bodyCiphertext","bodyIv","bodyAuthTag",
             "summaryJsonCiphertext","summaryJsonIv","summaryJsonAuthTag",
             "summaryJsonUpdatedAt"::text AS "summaryUpdatedAtText",
             "wordCount","labelCiphertext","labelIv","labelAuthTag",
             "orderIndex","updatedAt"::text AS "updatedAtText"
      FROM "Draft"`);
    expect(res.rows).toHaveLength(Object.keys(CHAPTERS).length);
    for (const [id, c] of Object.entries(CHAPTERS)) {
      const d = res.rows.find((r) => r.chapterId === id);
      expect(d, `draft for ${id}`).toBeDefined();
      expect(d.bodyCiphertext).toBe(c.body?.[0] ?? null);
      expect(d.bodyIv).toBe(c.body?.[1] ?? null);
      expect(d.bodyAuthTag).toBe(c.body?.[2] ?? null);
      expect(d.summaryJsonCiphertext).toBe(c.summary?.[0] ?? null);
      expect(d.summaryJsonIv).toBe(c.summary?.[1] ?? null);
      expect(d.summaryJsonAuthTag).toBe(c.summary?.[2] ?? null);
      expect(d.summaryUpdatedAtText).toBe(c.summaryUpdatedAt);
      expect(d.wordCount).toBe(c.wordCount);
      expect(d.labelCiphertext).toBeNull();
      expect(d.labelIv).toBeNull();
      expect(d.labelAuthTag).toBeNull();
      expect(d.orderIndex).toBe(0);
      expect(d.updatedAtText).toBe(CHAPTER_UPDATED_AT);
    }
  });

  it('points every chapter at its backfilled draft', async () => {
    const res = await scratch.query(`
      SELECT c."id", c."activeDraftId", d."chapterId" AS "draftChapterId"
      FROM "Chapter" c LEFT JOIN "Draft" d ON d."id" = c."activeDraftId"`);
    expect(res.rows).toHaveLength(Object.keys(CHAPTERS).length);
    for (const row of res.rows) {
      expect(row.activeDraftId, `activeDraftId for ${row.id}`).not.toBeNull();
      expect(row.draftChapterId).toBe(row.id);
    }
  });

  it('re-points every chat at its chapter draft, messages intact', async () => {
    const chats = await scratch.query(`
      SELECT ch."id", ch."kind", d."chapterId" AS "viaDraft"
      FROM "Chat" ch JOIN "Draft" d ON d."id" = ch."draftId"`);
    expect(chats.rows).toHaveLength(Object.keys(CHATS).length);
    for (const [id, seed] of Object.entries(CHATS)) {
      const row = chats.rows.find((r) => r.id === id);
      expect(row, `chat ${id}`).toBeDefined();
      expect(row.viaDraft).toBe(seed.chapterId);
      expect(row.kind).toBe(seed.kind);
    }
    const msgs = await scratch.query(
      `SELECT "id","chatId","role","contentCiphertext" FROM "Message"`,
    );
    expect(msgs.rows).toHaveLength(Object.keys(MESSAGES).length);
    for (const [id, seed] of Object.entries(MESSAGES)) {
      const row = msgs.rows.find((r) => r.id === id);
      expect(row, `message ${id}`).toBeDefined();
      expect(row.chatId).toBe(seed.chatId);
      expect(row.role).toBe(seed.role);
      expect(row.contentCiphertext).toBe(seed.content);
    }
  });

  it('drops the superseded columns and enforces NOT NULL on Chat.draftId', async () => {
    const gone = await scratch.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND (
        (table_name = 'Chapter' AND column_name IN
          ('status','bodyCiphertext','bodyIv','bodyAuthTag',
           'summaryJsonCiphertext','summaryJsonIv','summaryJsonAuthTag',
           'summaryJsonUpdatedAt','wordCount'))
        OR (table_name = 'Chat' AND column_name = 'chapterId'))`);
    expect(gone.rows).toEqual([]);
    const draftIdCol = await scratch.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Chat' AND column_name = 'draftId'`);
    expect(draftIdCol.rows).toEqual([{ is_nullable: 'NO' }]);
  });

  it('creates no orphans', async () => {
    const counts = await scratch.query(`
      SELECT (SELECT count(*)::int FROM "Draft") AS drafts,
             (SELECT count(*)::int FROM "Chapter") AS chapters,
             (SELECT count(*)::int FROM "Draft" dd
              WHERE NOT EXISTS (SELECT 1 FROM "Chapter" cc WHERE cc."id" = dd."chapterId")) AS orphan_drafts`);
    expect(counts.rows[0]).toEqual({
      drafts: Object.keys(CHAPTERS).length,
      chapters: Object.keys(CHAPTERS).length,
      orphan_drafts: 0,
    });
  });

  it('a second deploy is a recorded no-op', async () => {
    const secondOutput = migrateDeploy();
    expect(secondOutput).toMatch(/No pending migrations/);
    const drafts = await scratch.query(`SELECT count(*)::int AS n FROM "Draft"`);
    expect(drafts.rows[0].n).toBe(Object.keys(CHAPTERS).length);
  });
});
