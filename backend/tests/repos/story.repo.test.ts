import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { resetDb } from '../helpers/db';
import { prisma } from '../setup';
import { makeUserContext, rawCiphertextMustNotEqual } from './_req';

describe('[E9] story.repo — encrypt on write / decrypt on read', () => {
  beforeEach(resetDb);
  afterEach(resetDb);

  it('create() writes ciphertext triples and returns decrypted plaintext without ciphertext fields', async () => {
    const ctx = await makeUserContext();
    const repo = createStoryRepo(ctx.req);

    const result = await repo.create({
      title: 'The Long Road',
      synopsis: 'A quiet epic.',
      worldNotes: 'Two suns. Magnetic north is mutable.',
      genre: 'fantasy',
      targetWords: 90000,
    });

    expect(result.title).toBe('The Long Road');
    expect(result.synopsis).toBe('A quiet epic.');
    expect(result.worldNotes).toBe('Two suns. Magnetic north is mutable.');
    expect(result.genre).toBe('fantasy');
    expect(result.targetWords).toBe(90000);

    // None of the ciphertext fields leak to the caller.
    for (const k of Object.keys(result)) {
      expect(k.endsWith('Ciphertext')).toBe(false);
      expect(k.endsWith('Iv')).toBe(false);
      expect(k.endsWith('AuthTag')).toBe(false);
    }

    // Raw DB read shows ciphertext is actually populated and not just base64(plaintext).
    const raw = await prisma.story.findUniqueOrThrow({ where: { id: result.id as string } });
    expect(raw.titleCiphertext).toBeTruthy();
    expect(raw.titleIv).toBeTruthy();
    expect(raw.titleAuthTag).toBeTruthy();
    rawCiphertextMustNotEqual(raw.titleCiphertext!, 'The Long Road');
  });

  it('findById() decrypts ciphertext and scopes by userId', async () => {
    const alice = await makeUserContext('alice');
    const bob = await makeUserContext('bob');
    const aliceRepo = createStoryRepo(alice.req);
    const bobRepo = createStoryRepo(bob.req);

    const s = await aliceRepo.create({ title: "alice's" });
    const found = await aliceRepo.findById(s.id as string);
    expect(found?.title).toBe("alice's");

    // Bob can't see it.
    const nope = await bobRepo.findById(s.id as string);
    expect(nope).toBeNull();
  });

  it('update() re-encrypts changed fields and leaves unchanged ones intact', async () => {
    const ctx = await makeUserContext();
    const repo = createStoryRepo(ctx.req);
    const s = await repo.create({ title: 'Old', synopsis: 'Draft' });
    const before = await prisma.story.findUniqueOrThrow({ where: { id: s.id as string } });

    const updated = await repo.update(s.id as string, { title: 'New' });
    expect(updated?.title).toBe('New');
    expect(updated?.synopsis).toBe('Draft');

    const after = await prisma.story.findUniqueOrThrow({ where: { id: s.id as string } });
    expect(after.titleCiphertext).not.toBe(before.titleCiphertext);
    // Untouched field keeps its ciphertext.
    expect(after.synopsisCiphertext).toBe(before.synopsisCiphertext);
  });

  it("update() respects user ownership — Bob cannot mutate Alice's row", async () => {
    const alice = await makeUserContext('alice-upd');
    const bob = await makeUserContext('bob-upd');
    const aliceRepo = createStoryRepo(alice.req);
    const bobRepo = createStoryRepo(bob.req);

    const s = await aliceRepo.create({ title: 'alice-original' });
    const before = await prisma.story.findUniqueOrThrow({ where: { id: s.id as string } });

    const result = await bobRepo.update(s.id as string, { title: 'bob-tampered' });
    expect(result).toBeNull();

    const after = await prisma.story.findUniqueOrThrow({ where: { id: s.id as string } });
    // Post-[E11] the plaintext `title` column is gone — the ciphertext
    // triple is the sole source of truth. Compare it instead.
    expect(after.titleCiphertext).toBe(before.titleCiphertext);
    expect(after.titleIv).toBe(before.titleIv);
    expect(after.titleAuthTag).toBe(before.titleAuthTag);
  });

  it('readEncrypted throws if no DEK is attached to the request (hardened post-review)', async () => {
    const ctx = await makeUserContext('no-dek');
    const repo = createStoryRepo(ctx.req);
    const s = await repo.create({ title: 'locked' });

    // Construct a fresh req without calling attachDekToRequest.
    const { createStoryRepo: freshRepo } = await import('../../src/repos/story.repo.js');
    const noDekReq = {
      user: { id: ctx.user.id, email: null },
    } as unknown as import('express').Request;
    const { DekNotAvailableError } = await import('../../src/services/content-crypto.service.js');
    await expect(freshRepo(noDekReq).findById(s.id as string)).rejects.toBeInstanceOf(
      DekNotAvailableError,
    );
  });

  it('remove() respects user ownership', async () => {
    const alice = await makeUserContext('alice2');
    const bob = await makeUserContext('bob2');
    const aliceRepo = createStoryRepo(alice.req);
    const bobRepo = createStoryRepo(bob.req);

    const s = await aliceRepo.create({ title: 'to-delete' });
    const nope = await bobRepo.remove(s.id as string);
    expect(nope).toBe(false);
    const yep = await aliceRepo.remove(s.id as string);
    expect(yep).toBe(true);
  });

  describe('contentUpdatedAtMax()', () => {
    it('returns the story row updatedAt when the subtree is empty', async () => {
      const ctx = await makeUserContext();
      const repo = createStoryRepo(ctx.req);
      const s = await repo.create({ title: 'Lonely story' });

      const max = await repo.contentUpdatedAtMax(s.id as string);
      expect(max.getTime()).toBe((s.updatedAt as Date).getTime());
    });

    it('bumps when a deep child (message) is edited after the story itself last changed', async () => {
      const ctx = await makeUserContext();
      const storyRepo = createStoryRepo(ctx.req);
      const chapterRepo = createChapterRepo(ctx.req);
      const chatRepo = createChatRepo(ctx.req);
      const messageRepo = createMessageRepo(ctx.req);

      const s = await storyRepo.create({ title: 'Deep subtree' });
      const chapter = await chapterRepo.create({
        storyId: s.id as string,
        title: 'Ch1',
        orderIndex: 0,
      });
      const chat = await chatRepo.create({ chapterId: chapter.id });
      const message = await messageRepo.create({
        chatId: chat.id,
        role: 'user',
        content: 'hello',
      });

      const beforeEdit = await storyRepo.contentUpdatedAtMax(s.id as string);

      // Ensure a strictly later timestamp on the next write.
      await new Promise((r) => setTimeout(r, 5));
      const edited = await messageRepo.update(message.id, chat.id, { content: 'hello, edited' });
      expect(edited?.updatedAt).not.toBeNull();

      // Prisma's `@updatedAt` bumps Chat.updatedAt on ANY row write (the same
      // message-edit transaction also touches Chat.lastActivityAt), so the
      // max may land on the chat row rather than the message row itself —
      // assert the subtree-max invariant (it moved forward), not which
      // specific row supplied it.
      const afterEdit = await storyRepo.contentUpdatedAtMax(s.id as string);
      expect(afterEdit.getTime()).toBeGreaterThan(beforeEdit.getTime());
      expect(afterEdit.getTime()).toBeGreaterThanOrEqual((edited?.updatedAt as Date).getTime());
    });

    it('throws when the story is not owned by the caller', async () => {
      const alice = await makeUserContext('alice-max');
      const bob = await makeUserContext('bob-max');
      const aliceRepo = createStoryRepo(alice.req);
      const bobRepo = createStoryRepo(bob.req);

      const s = await aliceRepo.create({ title: 'alice-only' });
      await expect(bobRepo.contentUpdatedAtMax(s.id as string)).rejects.toThrow();
    });
  });
});
