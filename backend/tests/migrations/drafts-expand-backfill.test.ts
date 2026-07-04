import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { resetDb } from '../helpers/db';
import { makeUserContext } from '../repos/_req';
import { prisma } from '../setup';

// The backfill statements are read from the REAL migration file so this test
// can never drift from the SQL that actually ships. Prisma's $executeRawUnsafe
// submits one prepared statement per call (a semicolon-joined multi-statement
// string is rejected), so the block is split on `;` and each statement runs
// individually inside one transaction — safe here because the backfill SQL
// contains no semicolons inside string literals.
const MIGRATION_PATH = join(
  __dirname,
  '../../prisma/migrations/20260629185340_drafts_expand/migration.sql',
);
const BACKFILL_MARKER = '-- [9wk.2] EXPAND backfill';

function loadBackfillStatements(): string[] {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  const markerAt = sql.indexOf(BACKFILL_MARKER);
  if (markerAt === -1) {
    throw new Error(`backfill marker "${BACKFILL_MARKER}" not found in ${MIGRATION_PATH}`);
  }
  return sql
    .slice(markerAt)
    .split(';')
    .map((stmt) =>
      stmt
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((stmt) => stmt.length > 0);
}

const BACKFILL_STATEMENTS = loadBackfillStatements();

// Each element is a single prepared statement; run them in one transaction.
async function runBackfill() {
  await prisma.$transaction(BACKFILL_STATEMENTS.map((sql) => prisma.$executeRawUnsafe(sql)));
}

describe('[9wk.2] drafts expand backfill — verbatim ciphertext relocation', () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await resetDb();
  });

  it('extracts the three backfill statements from the migration file in order', () => {
    expect(BACKFILL_STATEMENTS).toHaveLength(3);
    expect(BACKFILL_STATEMENTS[0]).toMatch(/^INSERT INTO "Draft"/);
    expect(BACKFILL_STATEMENTS[1]).toMatch(/^UPDATE "Chapter" c/);
    expect(BACKFILL_STATEMENTS[2]).toMatch(/^UPDATE "Chat" ch/);
  });

  it('creates one draft per draftless chapter, copies ciphertext byte-for-byte, sets pointers', async () => {
    const ctx = await makeUserContext('backfill');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    // chapterRepo.create writes an encrypted body but does NOT create a draft —
    // so the chapter is "draftless", exactly the pre-migration shape.
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'backfill me' }] }],
      },
      wordCount: 2,
      orderIndex: 0,
    });
    const chat = await createChatRepo(ctx.req).create({ chapterId: chapter.id, title: 'T' });

    // Capture the chapter's raw body ciphertext BEFORE backfill.
    const before = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapter.id },
      select: { bodyCiphertext: true, bodyIv: true, bodyAuthTag: true, wordCount: true },
    });

    // Run the backfill (the same SQL the migration runs).
    await runBackfill();

    // Exactly one draft for the chapter, ciphertext copied byte-for-byte.
    const drafts = await prisma.draft.findMany({ where: { chapterId: chapter.id } });
    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft.bodyCiphertext).toBe(before.bodyCiphertext);
    expect(draft.bodyIv).toBe(before.bodyIv);
    expect(draft.bodyAuthTag).toBe(before.bodyAuthTag);
    expect(draft.wordCount).toBe(before.wordCount);
    expect(draft.orderIndex).toBe(0);
    expect(draft.labelCiphertext).toBeNull();
    expect(draft.labelIv).toBeNull();
    expect(draft.labelAuthTag).toBeNull();

    // Pointers set.
    const chapterAfter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(chapterAfter.activeDraftId).toBe(draft.id);
    const chatAfter = await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(chatAfter.draftId).toBe(draft.id);

    // Idempotent: a second run is a no-op (still exactly one draft).
    await runBackfill();
    expect(await prisma.draft.count({ where: { chapterId: chapter.id } })).toBe(1);
  });
});
