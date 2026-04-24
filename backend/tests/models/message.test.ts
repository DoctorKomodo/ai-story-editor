import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

// Post-[E11] Message.contentJson + Message.attachmentJson are ciphertext-only
// (stored as serialised JSON in the ciphertext triple). Round-trip is covered
// by tests/repos/message.repo.test.ts. Here we only test schema shape + the
// plaintext telemetry columns (role, model, tokens, latencyMs).

async function makeChat(email = 'msg-author@example.com') {
  const username = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  const user = await prisma.user.create({ data: { email, username, passwordHash: 'h' } });
  const story = await prisma.story.create({ data: { userId: user.id } });
  const chapter = await prisma.chapter.create({
    data: { orderIndex: 0, storyId: story.id },
  });
  return prisma.chat.create({ data: { chapterId: chapter.id } });
}

describe('Message model', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('creates a message with role + required chat ref (content is ciphertext-only)', async () => {
    const chat = await makeChat();
    const msg = await prisma.message.create({
      data: { chatId: chat.id, role: 'user' },
    });
    expect(msg.id).toMatch(/^c[a-z0-9]+$/);
    expect(msg.chatId).toBe(chat.id);
    expect(msg.role).toBe('user');
    expect(msg.model).toBeNull();
    expect(msg.tokens).toBeNull();
    expect(msg.latencyMs).toBeNull();
    expect(msg.contentJsonCiphertext).toBeNull();
    expect(msg.attachmentJsonCiphertext).toBeNull();
    expect(msg.createdAt).toBeInstanceOf(Date);
  });

  it('captures assistant telemetry (model, tokens, latencyMs)', async () => {
    const chat = await makeChat('tele@example.com');
    const msg = await prisma.message.create({
      data: {
        chatId: chat.id,
        role: 'assistant',
        model: 'venice-dolphin-70b',
        tokens: 412,
        latencyMs: 1823,
      },
    });
    expect(msg.role).toBe('assistant');
    expect(msg.model).toBe('venice-dolphin-70b');
    expect(msg.tokens).toBe(412);
    expect(msg.latencyMs).toBe(1823);
  });

  it('orders messages by createdAt within a chat', async () => {
    const chat = await makeChat('ord@example.com');
    const first = await prisma.message.create({
      data: { chatId: chat.id, role: 'user' },
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = await prisma.message.create({
      data: { chatId: chat.id, role: 'assistant' },
    });
    const ordered = await prisma.message.findMany({
      where: { chatId: chat.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(ordered.map((m) => m.id)).toEqual([first.id, second.id]);
  });

  it('cascades deletion when the parent chat is deleted', async () => {
    const chat = await makeChat('casc@example.com');
    await prisma.message.create({
      data: { chatId: chat.id, role: 'user' },
    });
    await prisma.chat.delete({ where: { id: chat.id } });
    expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(0);
  });
});
