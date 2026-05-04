import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';
import { createUser, resetNarrativeTables, SENTINEL } from './_helpers';

describe('[E4] Story — ciphertext columns', () => {
  beforeEach(resetNarrativeTables);
  afterEach(resetNarrativeTables);

  it('persists title/synopsis/worldNotes ciphertext triples', async () => {
    const user = await createUser();
    const created = await prisma.story.create({
      data: {
        userId: user.id,
        titleCiphertext: SENTINEL.ciphertext,
        titleIv: SENTINEL.iv,
        titleAuthTag: SENTINEL.authTag,
        synopsisCiphertext: SENTINEL.ciphertext,
        synopsisIv: SENTINEL.iv,
        synopsisAuthTag: SENTINEL.authTag,
        worldNotesCiphertext: SENTINEL.ciphertext,
        worldNotesIv: SENTINEL.iv,
        worldNotesAuthTag: SENTINEL.authTag,
      },
    });
    const read = await prisma.story.findUniqueOrThrow({ where: { id: created.id } });
    expect(read.titleCiphertext).toBe(SENTINEL.ciphertext);
    expect(read.titleIv).toBe(SENTINEL.iv);
    expect(read.titleAuthTag).toBe(SENTINEL.authTag);
    expect(read.synopsisCiphertext).toBe(SENTINEL.ciphertext);
    expect(read.worldNotesCiphertext).toBe(SENTINEL.ciphertext);
  });

  it('keeps genre, targetWords, userId, timestamps plaintext (unchanged)', async () => {
    const user = await createUser();
    const created = await prisma.story.create({
      data: {
        userId: user.id,
        genre: 'romance',
        targetWords: 90000,
      },
    });
    expect(created.genre).toBe('romance');
    expect(created.targetWords).toBe(90000);
    expect(created.userId).toBe(user.id);
  });

  it('ciphertext columns are nullable (a story with no fields set yet is legal)', async () => {
    const user = await createUser();
    const created = await prisma.story.create({
      data: { userId: user.id },
    });
    expect(created.titleCiphertext).toBeNull();
    expect(created.synopsisCiphertext).toBeNull();
  });
});
