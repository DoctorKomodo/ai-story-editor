import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { resetDb } from '../helpers/db';
import { makeUserContext } from '../repos/_req';
import { prisma } from '../setup';

// The three idempotent backfill statements from the drafts_expand migration,
// as SEPARATE statements. Prisma's $executeRawUnsafe submits one prepared
// statement per call (a semicolon-joined multi-statement string is rejected),
// so they run individually inside one transaction. The migration FILE keeps
// them as a single multi-statement block — the migration engine runs that
// fine; only this test path needs the split. Keep in sync with the migration.
const BACKFILL_STATEMENTS = [
  `INSERT INTO "Draft" (
  "id", "chapterId",
  "bodyCiphertext", "bodyIv", "bodyAuthTag",
  "summaryJsonCiphertext", "summaryJsonIv", "summaryJsonAuthTag", "summaryJsonUpdatedAt",
  "wordCount",
  "labelCiphertext", "labelIv", "labelAuthTag",
  "orderIndex", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, c."id",
  c."bodyCiphertext", c."bodyIv", c."bodyAuthTag",
  c."summaryJsonCiphertext", c."summaryJsonIv", c."summaryJsonAuthTag", c."summaryJsonUpdatedAt",
  c."wordCount",
  NULL, NULL, NULL,
  0, c."createdAt", c."updatedAt"
FROM "Chapter" c
WHERE NOT EXISTS (SELECT 1 FROM "Draft" d WHERE d."chapterId" = c."id")`,

  `UPDATE "Chapter" c
SET "activeDraftId" = d."id"
FROM "Draft" d
WHERE d."chapterId" = c."id" AND c."activeDraftId" IS NULL`,

  `UPDATE "Chat" ch
SET "draftId" = d."id"
FROM "Draft" d
WHERE d."chapterId" = ch."chapterId" AND ch."draftId" IS NULL`,
];

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
