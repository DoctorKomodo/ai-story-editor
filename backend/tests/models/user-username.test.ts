import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

describe('User.username identity', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('persists a username without requiring an email', async () => {
    const user = await prisma.user.create({
      data: { username: 'eira_v', passwordHash: 'h' },
    });
    expect(user.username).toBe('eira_v');
    expect(user.email).toBeNull();
  });

  it('enforces uniqueness on username', async () => {
    await prisma.user.create({ data: { username: 'dupname', passwordHash: 'h' } });
    await expect(
      prisma.user.create({ data: { username: 'dupname', passwordHash: 'h' } }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('allows two users with null emails alongside unique usernames', async () => {
    await prisma.user.create({ data: { username: 'a_one', passwordHash: 'h' } });
    const b = await prisma.user.create({ data: { username: 'b_two', passwordHash: 'h' } });
    expect(b.email).toBeNull();
  });

  it('still enforces uniqueness on email when provided', async () => {
    await prisma.user.create({
      data: { username: 'e1', email: 'same@example.com', passwordHash: 'h' },
    });
    await expect(
      prisma.user.create({
        data: { username: 'e2', email: 'same@example.com', passwordHash: 'h' },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});
