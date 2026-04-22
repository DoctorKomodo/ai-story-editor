import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStoryRepo } from '../../src/repos/story.repo';
import { prisma } from '../setup';
import { makeUserContext, rawCiphertextMustNotEqual, resetAllTables } from './_req';

describe('[E9] story.repo — encrypt on write / decrypt on read', () => {
  beforeEach(resetAllTables);
  afterEach(resetAllTables);

  it('create() writes ciphertext triples and returns decrypted plaintext without ciphertext fields', async () => {
    const ctx = await makeUserContext();
    const repo = createStoryRepo(ctx.req);

    const result = await repo.create({
      title: 'The Long Road',
      synopsis: 'A quiet epic.',
      worldNotes: 'Two suns. Magnetic north is mutable.',
      systemPrompt: 'Write in close third person.',
      genre: 'fantasy',
      targetWords: 90000,
    });

    expect(result.title).toBe('The Long Road');
    expect(result.synopsis).toBe('A quiet epic.');
    expect(result.worldNotes).toBe('Two suns. Magnetic north is mutable.');
    expect(result.systemPrompt).toBe('Write in close third person.');
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

  it('update() respects user ownership — Bob cannot mutate Alice\'s row', async () => {
    const alice = await makeUserContext('alice-upd');
    const bob = await makeUserContext('bob-upd');
    const aliceRepo = createStoryRepo(alice.req);
    const bobRepo = createStoryRepo(bob.req);

    const s = await aliceRepo.create({ title: 'alice-original' });
    const before = await prisma.story.findUniqueOrThrow({ where: { id: s.id as string } });

    const result = await bobRepo.update(s.id as string, { title: 'bob-tampered' });
    expect(result).toBeNull();

    const after = await prisma.story.findUniqueOrThrow({ where: { id: s.id as string } });
    expect(after.titleCiphertext).toBe(before.titleCiphertext);
    expect(after.title).toBe(before.title);
  });

  it('readEncrypted throws if no DEK is attached to the request (hardened post-review)', async () => {
    const ctx = await makeUserContext('no-dek');
    const repo = createStoryRepo(ctx.req);
    const s = await repo.create({ title: 'locked' });

    // Construct a fresh req without calling attachDekToRequest.
    const { createStoryRepo: freshRepo } = await import('../../src/repos/story.repo');
    const noDekReq = { user: { id: ctx.user.id, email: null } } as unknown as import('express').Request;
    const { DekNotAvailableError } = await import('../../src/services/content-crypto.service');
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
});
