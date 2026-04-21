import { describe, expect, it } from 'vitest';
import { prisma, testDatabaseUrl } from './setup';

describe('test setup', () => {
  it('sets NODE_ENV to test', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('resolves a test DATABASE_URL', () => {
    expect(testDatabaseUrl).toMatch(/^postgresql:\/\//);
    expect(process.env.DATABASE_URL).toBe(testDatabaseUrl);
  });

  it('exposes a connected Prisma client', async () => {
    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 as one`;
    expect(rows[0]?.one).toBe(1);
  });
});
