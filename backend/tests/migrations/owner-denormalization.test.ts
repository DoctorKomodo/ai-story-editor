import path from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lit, makeMigrationHarness } from './_harness';

// [story-editor-35u] Owner-denormalization migration harness. Validates the
// consolidated userId-backfill migration against a POPULATED pre-migration
// database (two users, each with a full narrative subtree), applied exactly
// the way an operator upgrade applies it (prisma migrate deploy). Opt-in:
// excluded from the default suite; run via `npm run test:migration-squash`
// with the compose stack up. Mirrors tests/migrations/drafts-squash.test.ts.
//
// Security posture: no DEK, no decryption, no plaintext narrative content.
// Every "ciphertext" below is an arbitrary marker string — the migration
// only backfills a plaintext userId column, it never touches ciphertext.

const { migrateDeploy, setup, teardown } = makeMigrationHarness({
  scratchDb: 'storyeditor_owner_denorm_test',
  fixture: path.join(__dirname, 'fixtures', 'pre-owner-denorm-baseline.sql'),
});

// ---- seed data (pre-migration shapes; raw SQL — no userId column exists
// ---- yet on this fixture's schema, by design) -------------------------------

const USERS = {
  'u-1': { username: 'denorm-user-1' },
  'u-2': { username: 'denorm-user-2' },
};

const STORIES: Record<string, { userId: string }> = {
  's-1': { userId: 'u-1' },
  's-2': { userId: 'u-2' },
};

const CHAPTERS: Record<string, { storyId: string; orderIndex: number }> = {
  'ch-1': { storyId: 's-1', orderIndex: 0 },
  'ch-2': { storyId: 's-2', orderIndex: 0 },
};

const CHARACTERS: Record<string, { storyId: string; orderIndex: number }> = {
  'char-1': { storyId: 's-1', orderIndex: 0 },
  'char-2': { storyId: 's-2', orderIndex: 0 },
};

const OUTLINE_ITEMS: Record<string, { storyId: string; order: number }> = {
  'outline-1': { storyId: 's-1', order: 0 },
  'outline-2': { storyId: 's-2', order: 0 },
};

const DRAFTS: Record<string, { chapterId: string; orderIndex: number }> = {
  'draft-1': { chapterId: 'ch-1', orderIndex: 0 },
  'draft-2': { chapterId: 'ch-2', orderIndex: 0 },
};

const CHATS: Record<string, { draftId: string; kind: 'ask' | 'scene' }> = {
  'chat-1': { draftId: 'draft-1', kind: 'ask' },
  'chat-2': { draftId: 'draft-2', kind: 'ask' },
};

const MESSAGES: Record<string, { chatId: string; role: string }> = {
  'msg-1': { chatId: 'chat-1', role: 'user' },
  'msg-2': { chatId: 'chat-1', role: 'assistant' },
  'msg-3': { chatId: 'chat-2', role: 'user' },
};

function seedSql(): string {
  const stmts: string[] = [];
  stmts.push(
    `INSERT INTO "User" ("id","username","passwordHash","updatedAt") VALUES\n` +
      Object.entries(USERS)
        .map(
          ([id, u]) => `  (${lit(id)},${lit(u.username)},'not-a-real-hash','2026-06-01 00:00:00')`,
        )
        .join(',\n') +
      ';',
  );
  stmts.push(
    `INSERT INTO "Story" ("id","userId","titleCiphertext","titleIv","titleAuthTag","updatedAt") VALUES\n` +
      Object.entries(STORIES)
        .map(
          ([id, s]) =>
            `  (${lit(id)},${lit(s.userId)},${lit(`ct:title:${id}`)},${lit(`iv:title:${id}`)},${lit(`tag:title:${id}`)},'2026-06-01 00:00:00')`,
        )
        .join(',\n') +
      ';',
  );
  for (const [id, c] of Object.entries(CHAPTERS)) {
    stmts.push(`INSERT INTO "Chapter"
      ("id","storyId","orderIndex","titleCiphertext","titleIv","titleAuthTag","updatedAt")
      VALUES (${lit(id)},${lit(c.storyId)},${c.orderIndex},
        ${lit(`ct:title:${id}`)},${lit(`iv:title:${id}`)},${lit(`tag:title:${id}`)},'2026-06-01 00:00:00');`);
  }
  for (const [id, c] of Object.entries(CHARACTERS)) {
    stmts.push(`INSERT INTO "Character"
      ("id","storyId","orderIndex","nameCiphertext","nameIv","nameAuthTag","updatedAt")
      VALUES (${lit(id)},${lit(c.storyId)},${c.orderIndex},
        ${lit(`ct:name:${id}`)},${lit(`iv:name:${id}`)},${lit(`tag:name:${id}`)},'2026-06-01 00:00:00');`);
  }
  for (const [id, o] of Object.entries(OUTLINE_ITEMS)) {
    stmts.push(`INSERT INTO "OutlineItem"
      ("id","storyId","order","status","titleCiphertext","titleIv","titleAuthTag","updatedAt")
      VALUES (${lit(id)},${lit(o.storyId)},${o.order},'todo',
        ${lit(`ct:title:${id}`)},${lit(`iv:title:${id}`)},${lit(`tag:title:${id}`)},'2026-06-01 00:00:00');`);
  }
  for (const [id, d] of Object.entries(DRAFTS)) {
    stmts.push(`INSERT INTO "Draft"
      ("id","chapterId","orderIndex","updatedAt")
      VALUES (${lit(id)},${lit(d.chapterId)},${d.orderIndex},'2026-06-01 00:00:00');`);
  }
  // Point each chapter at its draft so the fixture matches a real post-#155 shape.
  for (const [draftId, d] of Object.entries(DRAFTS)) {
    stmts.push(
      `UPDATE "Chapter" SET "activeDraftId" = ${lit(draftId)} WHERE "id" = ${lit(d.chapterId)};`,
    );
  }
  for (const [id, ch] of Object.entries(CHATS)) {
    stmts.push(`INSERT INTO "Chat"
      ("id","draftId","kind","titleCiphertext","titleIv","titleAuthTag","updatedAt")
      VALUES (${lit(id)},${lit(ch.draftId)},${lit(ch.kind)},
        ${lit(`ct:chat:${id}`)},${lit(`iv:chat:${id}`)},${lit(`tag:chat:${id}`)},'2026-06-01 00:00:00');`);
  }
  for (const [id, m] of Object.entries(MESSAGES)) {
    stmts.push(`INSERT INTO "Message"
      ("id","chatId","role","contentCiphertext","contentIv","contentAuthTag")
      VALUES (${lit(id)},${lit(m.chatId)},${lit(m.role)},
        ${lit(`ct:msg:${id}`)},${lit(`iv:${id}`)},${lit(`tag:${id}`)});`);
  }
  return stmts.join('\n');
}

// ---- harness ----------------------------------------------------------------

let scratch: Client;
let deployOutput = '';

describe('[story-editor-35u] owner-denormalization migration on populated pre-migration data', () => {
  beforeAll(async () => {
    scratch = await setup();
    await scratch.query(seedSql());

    deployOutput = migrateDeploy();
  }, 120_000);

  afterAll(async () => {
    await teardown(scratch);
  }, 120_000);

  it('deploy applied exactly the owner_denormalization migration', () => {
    expect(deployOutput).toMatch(/\d{14}_owner_denormalization/);
  });

  it('backfills userId on every table to match the owning story, for both users', async () => {
    const tables: Array<{ name: string; ids: Record<string, { userId: string }> }> = [
      {
        name: 'Chapter',
        ids: Object.fromEntries(
          Object.entries(CHAPTERS).map(([id, c]) => [id, { userId: STORIES[c.storyId].userId }]),
        ),
      },
      {
        name: 'Character',
        ids: Object.fromEntries(
          Object.entries(CHARACTERS).map(([id, c]) => [id, { userId: STORIES[c.storyId].userId }]),
        ),
      },
      {
        name: 'OutlineItem',
        ids: Object.fromEntries(
          Object.entries(OUTLINE_ITEMS).map(([id, o]) => [
            id,
            { userId: STORIES[o.storyId].userId },
          ]),
        ),
      },
      {
        name: 'Draft',
        ids: Object.fromEntries(
          Object.entries(DRAFTS).map(([id, d]) => [
            id,
            { userId: STORIES[CHAPTERS[d.chapterId].storyId].userId },
          ]),
        ),
      },
      {
        name: 'Chat',
        ids: Object.fromEntries(
          Object.entries(CHATS).map(([id, c]) => [
            id,
            { userId: STORIES[CHAPTERS[DRAFTS[c.draftId].chapterId].storyId].userId },
          ]),
        ),
      },
      {
        name: 'Message',
        ids: Object.fromEntries(
          Object.entries(MESSAGES).map(([id, m]) => [
            id,
            {
              userId: STORIES[CHAPTERS[DRAFTS[CHATS[m.chatId].draftId].chapterId].storyId].userId,
            },
          ]),
        ),
      },
    ];

    for (const { name, ids } of tables) {
      const res = await scratch.query(`SELECT id, "userId" FROM "${name}"`);
      expect(res.rows, `${name} row count`).toHaveLength(Object.keys(ids).length);
      for (const row of res.rows) {
        expect(row.userId, `${name} ${row.id} userId`).toBe(ids[row.id].userId);
      }
    }
  });

  it('enforces NOT NULL on every backfilled userId column', async () => {
    const res = await scratch.query(`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'userId'
        AND table_name IN ('Chapter','Character','OutlineItem','Draft','Chat','Message')
      ORDER BY table_name`);
    expect(res.rows).toEqual([
      { table_name: 'Chapter', is_nullable: 'NO' },
      { table_name: 'Character', is_nullable: 'NO' },
      { table_name: 'Chat', is_nullable: 'NO' },
      { table_name: 'Draft', is_nullable: 'NO' },
      { table_name: 'Message', is_nullable: 'NO' },
      { table_name: 'OutlineItem', is_nullable: 'NO' },
    ]);
  });

  it('adds the FK + index for every backfilled userId column', async () => {
    const fks = await scratch.query(`
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'userId'
        AND tc.table_name IN ('Chapter','Character','OutlineItem','Draft','Chat','Message')
      ORDER BY tc.table_name`);
    expect(fks.rows.map((r) => r.table_name)).toEqual([
      'Chapter',
      'Character',
      'Chat',
      'Draft',
      'Message',
      'OutlineItem',
    ]);

    const idxs = await scratch.query(`
      SELECT tablename, indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname LIKE '%_userId_idx'
        AND tablename IN ('Chapter','Character','OutlineItem','Draft','Chat','Message')
      ORDER BY tablename`);
    expect(idxs.rows.map((r) => r.tablename)).toEqual([
      'Chapter',
      'Character',
      'Chat',
      'Draft',
      'Message',
      'OutlineItem',
    ]);
  });

  it('a second deploy is a recorded no-op', async () => {
    const secondOutput = migrateDeploy();
    expect(secondOutput).toMatch(/No pending migrations/);
  });
});
