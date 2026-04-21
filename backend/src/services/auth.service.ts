import type { PrismaClient, User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma as defaultPrisma } from '../lib/prisma';

export const BCRYPT_ROUNDS = 12;

const emailSchema = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.string().email(),
  );

export const registerInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type RegisterInput = z.infer<typeof registerInputSchema>;
export type PublicUser = Pick<User, 'id' | 'email' | 'createdAt' | 'updatedAt'>;

export class EmailAlreadyRegisteredError extends Error {
  constructor(email: string) {
    super(`Email already registered: ${email}`);
    this.name = 'EmailAlreadyRegisteredError';
  }
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// Matches the SQL backfill in migration 20260421170000_add_mockup_driven_extensions
// so rows created by this service and rows migrated from the old schema share one
// username derivation rule.
function deriveUsernameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const cleaned = local.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (cleaned.length === 0) return 'user';
  if (cleaned.length < 3) return `${cleaned}user`;
  return cleaned.slice(0, 32);
}

async function pickAvailableUsername(client: PrismaClient, base: string): Promise<string> {
  let candidate = base;
  let suffix = 1;
  // Username clash probability on first registration is low; this loop is a
  // safety net for the backfill rule producing the same base for two users.
  // Bounded to keep the attack surface small.
  while (suffix < 10_000) {
    const clash = await client.user.findUnique({ where: { username: candidate } });
    if (!clash) return candidate;
    candidate = `${base}${suffix}`.slice(0, 32);
    suffix += 1;
  }
  throw new Error('Could not allocate a unique username');
}

export function createAuthService(client: PrismaClient = defaultPrisma) {
  async function register(rawInput: unknown): Promise<PublicUser> {
    const input = registerInputSchema.parse(rawInput);

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const baseUsername = deriveUsernameFromEmail(input.email);
    const username = await pickAvailableUsername(client, baseUsername);

    try {
      const user = await client.user.create({
        data: { email: input.email, username, passwordHash },
      });
      return toPublicUser(user);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new EmailAlreadyRegisteredError(input.email);
      }
      throw err;
    }
  }

  return { register };
}

export const authService = createAuthService();
