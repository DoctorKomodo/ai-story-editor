import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';
import { createStoryRow, createUser, resetNarrativeTables, SENTINEL } from './_helpers';

describe('[E6] Character — ciphertext columns', () => {
  beforeEach(resetNarrativeTables);
  afterEach(resetNarrativeTables);

  it('persists ciphertext triples for every narrative field', async () => {
    const user = await createUser();
    const story = await createStoryRow(user.id);
    const created = await prisma.character.create({
      data: {
        storyId: story.id,
        color: '#cafe00',
        initial: 'P',
        nameCiphertext: SENTINEL.ciphertext,
        nameIv: SENTINEL.iv,
        nameAuthTag: SENTINEL.authTag,
        roleCiphertext: SENTINEL.ciphertext,
        roleIv: SENTINEL.iv,
        roleAuthTag: SENTINEL.authTag,
        ageCiphertext: SENTINEL.ciphertext,
        ageIv: SENTINEL.iv,
        ageAuthTag: SENTINEL.authTag,
        appearanceCiphertext: SENTINEL.ciphertext,
        appearanceIv: SENTINEL.iv,
        appearanceAuthTag: SENTINEL.authTag,
        voiceCiphertext: SENTINEL.ciphertext,
        voiceIv: SENTINEL.iv,
        voiceAuthTag: SENTINEL.authTag,
        arcCiphertext: SENTINEL.ciphertext,
        arcIv: SENTINEL.iv,
        arcAuthTag: SENTINEL.authTag,
        physicalDescriptionCiphertext: SENTINEL.ciphertext,
        physicalDescriptionIv: SENTINEL.iv,
        physicalDescriptionAuthTag: SENTINEL.authTag,
        personalityCiphertext: SENTINEL.ciphertext,
        personalityIv: SENTINEL.iv,
        personalityAuthTag: SENTINEL.authTag,
        backstoryCiphertext: SENTINEL.ciphertext,
        backstoryIv: SENTINEL.iv,
        backstoryAuthTag: SENTINEL.authTag,
        notesCiphertext: SENTINEL.ciphertext,
        notesIv: SENTINEL.iv,
        notesAuthTag: SENTINEL.authTag,
      },
    });
    const read = await prisma.character.findUniqueOrThrow({ where: { id: created.id } });
    for (const f of [
      'nameCiphertext',
      'roleCiphertext',
      'ageCiphertext',
      'appearanceCiphertext',
      'voiceCiphertext',
      'arcCiphertext',
      'physicalDescriptionCiphertext',
      'personalityCiphertext',
      'backstoryCiphertext',
      'notesCiphertext',
    ] as const) {
      expect(read[f]).toBe(SENTINEL.ciphertext);
    }
  });

  it('keeps color, initial, storyId plaintext (UI hints + FK)', async () => {
    const user = await createUser();
    const story = await createStoryRow(user.id);
    const created = await prisma.character.create({
      data: { storyId: story.id, color: '#111222', initial: 'X' },
    });
    expect(created.color).toBe('#111222');
    expect(created.initial).toBe('X');
    expect(created.storyId).toBe(story.id);
  });
});
