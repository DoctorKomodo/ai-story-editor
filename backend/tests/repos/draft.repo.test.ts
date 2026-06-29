import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createDraftRepo } from '../../src/repos/draft.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { testDatabaseUrl } from '../setup';
import { makeUserContext, rawCiphertextMustNotEqual, resetAllTables } from './_req';

describe('[9wk.2] draft.repo — encrypt on write / decrypt on read', () => {
  beforeEach(async () => {
    await resetAllTables();
  });
  afterEach(async () => {
    await resetAllTables();
  });

  it('round-trips body, summary, and label through the DEK', async () => {
    const ctx = await makeUserContext('draft-repo');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });

    const draftRepo = createDraftRepo(ctx.req);
    const created = await draftRepo.create({
      chapterId: chapter.id,
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello drafts' }] }],
      },
      summaryJson: { events: 'e', stateAtEnd: 's', openThreads: 'o' },
      label: 'darker take',
      wordCount: 2,
      orderIndex: 0,
    });

    // Decrypted shape is correct, and carries no ciphertext columns.
    expect(created.label).toBe('darker take');
    expect(created.wordCount).toBe(2);
    expect(created.summary).toEqual({ events: 'e', stateAtEnd: 's', openThreads: 'o' });
    expect(JSON.stringify(created.bodyJson)).toContain('hello drafts');
    expect(
      Object.keys(created as Record<string, unknown>).some(
        (k) => k.endsWith('Ciphertext') || k.endsWith('Iv') || k.endsWith('AuthTag'),
      ),
    ).toBe(false);

    // Re-read decrypts identically.
    const read = await draftRepo.findById(created.id);
    expect(read?.label).toBe('darker take');
    expect(read?.summary).toEqual({ events: 'e', stateAtEnd: 's', openThreads: 'o' });

    // Raw columns are actually ciphertext (not naive base64 of plaintext) and
    // contain no plaintext.
    const pg = new Client({ connectionString: testDatabaseUrl });
    await pg.connect();
    try {
      const { rows } = await pg.query<{
        labelCiphertext: string | null;
        bodyCiphertext: string | null;
      }>(`SELECT "labelCiphertext", "bodyCiphertext" FROM "Draft" WHERE "id" = $1`, [created.id]);
      expect(rows).toHaveLength(1);
      rawCiphertextMustNotEqual(rows[0]!.labelCiphertext as string, 'darker take');
      expect(rows[0]!.bodyCiphertext).not.toContain('hello drafts');
    } finally {
      await pg.end();
    }
  });

  it('stores null triples for an absent body/summary/label', async () => {
    const ctx = await makeUserContext('draft-repo-null');
    const story = await createStoryRepo(ctx.req).create({
      title: 'S',
      genre: null,
      targetWords: null,
    });
    const chapter = await createChapterRepo(ctx.req).create({
      storyId: story.id as string,
      title: 'C',
      orderIndex: 0,
    });
    const created = await createDraftRepo(ctx.req).create({ chapterId: chapter.id, orderIndex: 0 });
    expect(created.bodyJson).toBeNull();
    expect(created.summary).toBeNull();
    expect(created.label).toBeNull();
  });
});
