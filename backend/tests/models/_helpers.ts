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

export async function createStoryRow(userId: string) {
  return prisma.story.create({
    data: { userId, title: 'Temp Title' },
  });
}

export async function createChapterRow(storyId: string) {
  return prisma.chapter.create({
    data: { storyId, title: 'Temp Ch', orderIndex: 0 },
  });
}

export async function createChatRow(chapterId: string) {
  return prisma.chat.create({
    data: { chapterId },
  });
}

export async function resetNarrativeTables(): Promise<void> {
  // Narrative entities cascade from Story, so wiping users is enough; but we
  // also clear Session + RefreshToken because setup tests may have left rows.
  await prisma.session.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

// A sentinel ciphertext triple for schema-shape tests. The repo layer ([E9])
// handles real encrypt/decrypt; here we just confirm Prisma accepts the new
// columns and Postgres persists them.
export const SENTINEL = {
  ciphertext: 'AAAA',
  iv: 'BBBB',
  authTag: 'CCCC',
};
