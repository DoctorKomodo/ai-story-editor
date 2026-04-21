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
export type PublicUser = Omit<User, 'passwordHash'>;

export class EmailAlreadyRegisteredError extends Error {
  constructor(email: string) {
    super(`Email already registered: ${email}`);
    this.name = 'EmailAlreadyRegisteredError';
  }
}

function toPublicUser(user: User): PublicUser {
  const { passwordHash: _ignored, ...rest } = user;
  return rest;
}

export function createAuthService(client: PrismaClient = defaultPrisma) {
  async function register(rawInput: unknown): Promise<PublicUser> {
    const input = registerInputSchema.parse(rawInput);

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    try {
      const user = await client.user.create({
        data: { email: input.email, passwordHash },
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
