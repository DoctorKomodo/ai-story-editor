import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

function futureDate(daysFromNow = 7): Date {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
}

async function makeUser(email = 'rt-user@example.com') {
  const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return prisma.user.create({ data: { email, username, passwordHash: 'h' } });
}

describe('RefreshToken model', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('creates a refresh token linked to a user', async () => {
    const user = await makeUser();
    const expiresAt = futureDate();
    const token = await prisma.refreshToken.create({
      data: { token: 'tok-1', userId: user.id, expiresAt },
    });
    expect(token.id).toMatch(/^c[a-z0-9]+$/);
    expect(token.token).toBe('tok-1');
    expect(token.userId).toBe(user.id);
    expect(token.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(token.createdAt).toBeInstanceOf(Date);
  });

  it('enforces a unique token value', async () => {
    const user = await makeUser('rt-b@example.com');
    await prisma.refreshToken.create({
      data: { token: 'dup', userId: user.id, expiresAt: futureDate() },
    });
    await expect(
      prisma.refreshToken.create({
        data: { token: 'dup', userId: user.id, expiresAt: futureDate() },
      }),
    ).rejects.toThrow();
  });

  it('supports multiple tokens per user (rotation)', async () => {
    const user = await makeUser('rt-c@example.com');
    await prisma.refreshToken.createMany({
      data: [
        { token: 't-a', userId: user.id, expiresAt: futureDate() },
        { token: 't-b', userId: user.id, expiresAt: futureDate() },
        { token: 't-c', userId: user.id, expiresAt: futureDate() },
      ],
    });
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(3);
  });

  it('cascades refresh-token deletes when the user is deleted', async () => {
    const user = await makeUser('rt-d@example.com');
    await prisma.refreshToken.create({
      data: { token: 'orphan', userId: user.id, expiresAt: futureDate() },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });
});
