import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

async function makeChapter(email = 'chat-author@example.com') {
  const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const user = await prisma.user.create({ data: { email, username, passwordHash: 'h' } });
  const story = await prisma.story.create({ data: { title: 'S', userId: user.id } });
  return prisma.chapter.create({
    data: { title: 'Ch', orderIndex: 0, storyId: story.id },
  });
}

describe('Chat model', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('creates a chat with a nullable title', async () => {
    const chapter = await makeChapter();
    const chat = await prisma.chat.create({ data: { chapterId: chapter.id } });
    expect(chat.id).toMatch(/^c[a-z0-9]+$/);
    expect(chat.chapterId).toBe(chapter.id);
    expect(chat.title).toBeNull();
    expect(chat.createdAt).toBeInstanceOf(Date);
    expect(chat.updatedAt).toBeInstanceOf(Date);
  });

  it('persists a chat title when provided', async () => {
    const chapter = await makeChapter('t@example.com');
    const chat = await prisma.chat.create({
      data: { chapterId: chapter.id, title: 'Pacing of Ch. 3' },
    });
    expect(chat.title).toBe('Pacing of Ch. 3');
  });

  it('cascades deletion when the chapter is deleted', async () => {
    const chapter = await makeChapter('casc@example.com');
    const chat = await prisma.chat.create({ data: { chapterId: chapter.id } });
    await prisma.chapter.delete({ where: { id: chapter.id } });
    expect(await prisma.chat.findUnique({ where: { id: chat.id } })).toBeNull();
  });
});
