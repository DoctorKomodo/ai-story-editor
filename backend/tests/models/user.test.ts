import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

describe('User model', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('creates a user with cuid id and timestamps', async () => {
    const user = await prisma.user.create({
      data: { email: 'alice@example.com', username: 'alice', passwordHash: 'hash-alice' },
    });
    expect(user.id).toMatch(/^c[a-z0-9]+$/);
    expect(user.email).toBe('alice@example.com');
    expect(user.passwordHash).toBe('hash-alice');
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  it('enforces a unique email', async () => {
    await prisma.user.create({
      data: { email: 'bob@example.com', username: 'bob-a', passwordHash: 'h1' },
    });
    await expect(
      prisma.user.create({
        data: { email: 'bob@example.com', username: 'bob-b', passwordHash: 'h2' },
      }),
    ).rejects.toThrow();
  });

  it('updates updatedAt on change', async () => {
    const user = await prisma.user.create({
      data: { email: 'carol@example.com', username: 'carol', passwordHash: 'h' },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: 'h-new' },
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(user.updatedAt.getTime());
  });
});
