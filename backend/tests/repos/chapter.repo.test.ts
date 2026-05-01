import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { prisma } from '../setup';
import { makeUserContext, rawCiphertextMustNotEqual, resetAllTables } from './_req';

describe('[E9] chapter.repo — encrypt on write / decrypt on read', () => {
  beforeEach(resetAllTables);
  afterEach(resetAllTables);

  it('round-trips title + body (TipTap JSON tree) through encrypt/decrypt', async () => {
    const ctx = await makeUserContext();
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createChapterRepo(ctx.req);

    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The night was young.' }] }],
    };
    const created = await repo.create({
      storyId: story.id as string,
      title: 'Chapter One',
      bodyJson: body,
      wordCount: 4,
      orderIndex: 0,
    });

    expect(created.title).toBe('Chapter One');
    expect(created.bodyJson).toEqual(body);
    expect(created.wordCount).toBe(4);
    expect(created.orderIndex).toBe(0);

    // Ciphertext present in the DB.
    const raw = await prisma.chapter.findUniqueOrThrow({ where: { id: created.id as string } });
    expect(raw.titleCiphertext).toBeTruthy();
    expect(raw.bodyCiphertext).toBeTruthy();
    rawCiphertextMustNotEqual(raw.bodyCiphertext!, JSON.stringify(body));
  });

  it('findById enforces ownership via nested story.userId', async () => {
    const alice = await makeUserContext('alice-ch');
    const bob = await makeUserContext('bob-ch');
    const story = await createStoryRepo(alice.req).create({ title: 's' });
    const ch = await createChapterRepo(alice.req).create({
      storyId: story.id as string,
      title: 't',
      orderIndex: 0,
    });
    const bobRepo = createChapterRepo(bob.req);
    expect(await bobRepo.findById(ch.id as string)).toBeNull();
  });

  it('findManyForStory returns metadata-only rows — title decrypted, no bodyJson', async () => {
    const ctx = await makeUserContext('many-meta');
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createChapterRepo(ctx.req);
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'secret prose' }] }],
    };
    await repo.create({
      storyId: story.id as string,
      title: 'Encrypted Title',
      bodyJson: body,
      wordCount: 2,
      orderIndex: 0,
    });

    const list = await repo.findManyForStory(story.id as string);
    expect(list).toHaveLength(1);
    const ch = list[0]!;
    // Title is decrypted (otherwise the sidebar can't render).
    expect(ch.title).toBe('Encrypted Title');
    // Metadata is present.
    expect(ch.wordCount).toBe(2);
    expect(ch.orderIndex).toBe(0);
    expect(ch.status).toBe('draft');
    // Body must NOT be present in the metadata projection — search the full
    // object so this fails loudly if a future change reintroduces it.
    expect(Object.keys(ch as Record<string, unknown>)).not.toContain('bodyJson');
    expect(Object.keys(ch as Record<string, unknown>)).not.toContain('body');
    // Ciphertext columns are stripped by `projectDecrypted` regardless.
    expect(Object.keys(ch as Record<string, unknown>)).not.toContain('bodyCiphertext');
    expect(Object.keys(ch as Record<string, unknown>)).not.toContain('titleCiphertext');
  });

  it('update replaces body ciphertext; wordCount stays plaintext', async () => {
    const ctx = await makeUserContext();
    const story = await createStoryRepo(ctx.req).create({ title: 's' });
    const repo = createChapterRepo(ctx.req);
    const ch = await repo.create({
      storyId: story.id as string,
      title: 't',
      bodyJson: { type: 'doc', content: [] },
      orderIndex: 0,
      wordCount: 0,
    });
    const updated = await repo.update(ch.id as string, {
      bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      wordCount: 42,
    });
    expect(updated?.bodyJson).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(updated?.wordCount).toBe(42);
  });
});
