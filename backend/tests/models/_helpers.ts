import { prisma } from '../setup';

export async function createUser(username = `m-${Math.random().toString(36).slice(2, 10)}`) {
  return prisma.user.create({
    data: {
      username,
      name: 'Model Test',
      passwordHash: 'unused-in-schema-shape-tests',
    },
  });
}

// Post-[E11] narrative columns are ciphertext-only. Schema-shape tests that
// just need "some row" to exist can omit every narrative field — the schema
// makes them all nullable (ciphertext triples are optional).
export async function createStoryRow(userId: string) {
  return prisma.story.create({ data: { userId } });
}

export async function createChapterRow(storyId: string, userId: string) {
  return prisma.chapter.create({ data: { storyId, orderIndex: 0, userId } });
}

export async function createChatRow(chapterId: string, userId: string) {
  const draft = await prisma.draft.create({ data: { chapterId, orderIndex: 0, userId } });
  return prisma.chat.create({ data: { draftId: draft.id, userId } });
}

// A sentinel ciphertext triple for schema-shape tests. The repo layer ([E9])
// handles real encrypt/decrypt; here we just confirm Prisma accepts the new
// columns and Postgres persists them.
export const SENTINEL = {
  ciphertext: 'AAAA',
  iv: 'BBBB',
  authTag: 'CCCC',
};
