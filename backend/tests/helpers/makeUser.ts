import type { Prisma, PrismaClient, User } from '@prisma/client';

// Keep the username derivation rule in lockstep with auth.service.deriveUsernameFromEmail()
// and the SQL backfill in 20260421170000_add_mockup_driven_extensions. Tests that create
// users directly (bypassing auth.service) use this helper so they honour the NOT NULL
// username constraint introduced in D15.
function usernameFromEmail(email: string | null | undefined, fallback: string): string {
  if (!email) return fallback;
  const local = email.split('@')[0] ?? '';
  const cleaned = local.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (cleaned.length === 0) return fallback;
  if (cleaned.length < 3) return `${cleaned}user`;
  return cleaned.slice(0, 32);
}

export async function makeUser(
  client: PrismaClient,
  overrides: Partial<Prisma.UserCreateInput> & { email?: string | null } = {},
): Promise<User> {
  const email = overrides.email ?? `user-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const fallbackUsername = `u${Math.random().toString(36).slice(2, 10)}`;
  const username = overrides.username ?? usernameFromEmail(email, fallbackUsername);
  return client.user.create({
    data: {
      email,
      username,
      passwordHash: 'h',
      ...overrides,
      // Preserve caller intent — if they passed email: null, keep it null.
      ...(overrides.email === null ? { email: null } : {}),
    },
  });
}
