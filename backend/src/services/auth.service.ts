import crypto from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { prisma as defaultPrisma } from '../lib/prisma';
import { ARGON2_PARAMS } from './argon2.config';
import {
  generateDekAndWraps,
  InvalidRecoveryCodeError,
  rewrapRecoveryWrap,
  type UserDekColumns,
  unwrapDekWithPassword,
  unwrapDekWithRecoveryCode,
  wrapDek,
} from './content-crypto.service';
import { closeSession, closeSessionsForUser, IDLE_TTL_MS, openSession } from './session-store';

// Lazy dummy argon2id hash the login() path compares against when the username
// is unknown. Computed once on first use (not at module load) so cold-starting
// the service doesn't block the main thread for ~100ms before the port binds.
// The timing guarantee (both branches call verifyPassword once against an
// argon2id hash) is preserved: the first unknown-user login pays the one-time
// hash cost in addition to the verify; every call after that pays only the
// verify, matching the happy path.
let cachedDummyHash: string | null = null;
async function getDummyPasswordHash(): Promise<string> {
  if (cachedDummyHash) return cachedDummyHash;
  cachedDummyHash = await argon2.hash(' not-a-real-password ', ARGON2_PARAMS);
  return cachedDummyHash;
}

// Analogue of getDummyPasswordHash for the reset-password flow: a shared
// junk DEK + wraps used as a dummy target for unwrapDekWithRecoveryCode when
// the username doesn't exist. The KDF inside unwrapDek (argon2id, ~100ms)
// dominates the cost of a real unwrap, so running it once against a junk
// wrap equalises wall-clock timing between "no such user" and "wrong code".
let cachedDummyDekWraps: UserDekColumns | null = null;
async function getDummyDekWraps(): Promise<UserDekColumns> {
  if (cachedDummyDekWraps) return cachedDummyDekWraps;
  const gen = await generateDekAndWraps(' reset-timing-dummy ');
  cachedDummyDekWraps = {
    contentDekPasswordEnc: gen.passwordWrap.ciphertext,
    contentDekPasswordIv: gen.passwordWrap.iv,
    contentDekPasswordAuthTag: gen.passwordWrap.authTag,
    contentDekPasswordSalt: gen.passwordWrap.salt,
    contentDekRecoveryEnc: gen.recoveryWrap.ciphertext,
    contentDekRecoveryIv: gen.recoveryWrap.iv,
    contentDekRecoveryAuthTag: gen.recoveryWrap.authTag,
    contentDekRecoverySalt: gen.recoveryWrap.salt,
  };
  return cachedDummyDekWraps;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_PARAMS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (!hash.startsWith('$argon2')) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Warm the dummy hash on module load (fire-and-forget) so the first
// unknown-user login after process start doesn't pay double the argon2 cost.
// The timing defence still works without this, but a cold-start window of one
// anomalous request is removed.
void getDummyPasswordHash();
void getDummyDekWraps();

const USERNAME_REGEX = /^[a-z0-9_-]{3,32}$/;

const usernameSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.string().regex(USERNAME_REGEX, 'Invalid username'),
);

export const nameSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, 'Name is required').max(80, 'Name too long'));

// Password minimum: 8 in production, 4 elsewhere. Evaluated at schema build time
// rather than module load so NODE_ENV changes between tests are honoured.
function minPasswordLength(): number {
  return process.env.NODE_ENV === 'production' ? 8 : 4;
}

function buildRegisterSchema() {
  const min = minPasswordLength();
  return z.object({
    name: nameSchema,
    username: usernameSchema,
    password: z.string().min(min, `Password must be at least ${min} characters`),
  });
}

function buildLoginSchema() {
  return z.object({
    username: usernameSchema,
    password: z.string().min(1, 'Password is required'),
  });
}

export type RegisterInput = {
  name: string;
  username: string;
  password: string;
};
export type LoginInput = {
  username: string;
  password: string;
};
export type PublicUser = Pick<
  User,
  'id' | 'name' | 'username' | 'email' | 'createdAt' | 'updatedAt'
>;

export interface RegisterResult {
  user: PublicUser;
  // Surfaced exactly once at signup ([E3]). The frontend displays this with
  // a "save this now, it will not be shown again" warning. Server never
  // persists the plaintext code — only the argon2id-derived wrap of the DEK.
  recoveryCode: string;
}

// sessionId is an internal field consumed by the auth route to set the cookie.
// It is NOT included in the wire response body — the route returns only { user }.
export interface LoginResult {
  user: PublicUser;
  sessionId: string;
}

export class UsernameUnavailableError extends Error {
  constructor() {
    // Intentionally generic: the username is never interpolated into the
    // message so logging / Sentry / unhandled-error paths can't leak the
    // existing user list.
    super('Username unavailable');
    this.name = 'UsernameUnavailableError';
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function createAuthService(client: PrismaClient = defaultPrisma) {
  async function register(rawInput: unknown): Promise<RegisterResult> {
    const input = buildRegisterSchema().parse(rawInput);

    // Timing defence: do all expensive work (password hash + DEK wraps) before
    // the uniqueness check so the duplicate-username branch costs the same as
    // the happy path. Both branches pay: 1× argon2 password hash + 2× argon2
    // wrap-key derivation.
    const [passwordHash, dekAndWraps] = await Promise.all([
      hashPassword(input.password),
      generateDekAndWraps(input.password),
    ]);

    try {
      const user = await client.user.create({
        data: {
          name: input.name,
          username: input.username,
          passwordHash,
          contentDekPasswordEnc: dekAndWraps.passwordWrap.ciphertext,
          contentDekPasswordIv: dekAndWraps.passwordWrap.iv,
          contentDekPasswordAuthTag: dekAndWraps.passwordWrap.authTag,
          contentDekPasswordSalt: dekAndWraps.passwordWrap.salt,
          contentDekRecoveryEnc: dekAndWraps.recoveryWrap.ciphertext,
          contentDekRecoveryIv: dekAndWraps.recoveryWrap.iv,
          contentDekRecoveryAuthTag: dekAndWraps.recoveryWrap.authTag,
          contentDekRecoverySalt: dekAndWraps.recoveryWrap.salt,
        },
      });
      return { user: toPublicUser(user), recoveryCode: dekAndWraps.recoveryCode };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // The uniqueness constraint did the lookup — do NOT probe for
        // existence separately, which would open a find-then-insert race
        // and timing oracle. The duplicate path paid the same crypto cost
        // as the happy path above.
        throw new UsernameUnavailableError();
      }
      throw err;
    }
  }

  async function login(rawInput: unknown): Promise<LoginResult> {
    const input = buildLoginSchema().parse(rawInput);

    const user = await client.user.findUnique({ where: { username: input.username } });

    // Always run verifyPassword — if the user doesn't exist, compare against
    // a lazily-computed dummy argon2id hash so the response time doesn't
    // distinguish "wrong username" from "wrong password" (enumeration defence).
    const passwordHashForVerify = user?.passwordHash ?? (await getDummyPasswordHash());
    const passwordMatches = await verifyPassword(passwordHashForVerify, input.password);

    if (!user || !passwordMatches) {
      throw new InvalidCredentialsError();
    }

    // [E3] Unwrap the content DEK with the now-verified password. Every user
    // has password wraps from signup — a missing wrap column is a corrupted
    // row, not a legacy shape, so let unwrapDekWithPassword throw.
    const dek = await unwrapDekWithPassword(user, input.password);

    const sessionId = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    openSession({
      sessionId,
      userId: user.id,
      dek,
      createdAt: new Date(now),
      expiresAt: new Date(now + IDLE_TTL_MS),
    });

    return { user: toPublicUser(user), sessionId };
  }

  // Logout is best-effort: a missing or already-evicted sessionId is a no-op.
  // What matters is tearing down the in-memory DEK so a lost cookie can't be
  // replayed after the user clicks "log out".
  async function logout(sessionId: string): Promise<void> {
    closeSession(sessionId);
  }

  async function logoutAllSessionsForUser(userId: string): Promise<void> {
    closeSessionsForUser(userId);
  }

  // [AU15] Authenticated password change. Rewraps the content DEK under the
  // new password — narrative ciphertext is untouched. Invalidates all
  // in-memory sessions so any other logged-in device is forced through /login
  // again (where it will re-derive the wrap key from the new password).
  // Returns a fresh sessionId for the caller so the route can re-set the
  // cookie — the DEK is the same plaintext bytes before and after rewrap.
  // The recovery wrap is intentionally not rotated here; rotating the recovery
  // code is a separate, explicit user action ([AU17]).
  async function changePassword(input: {
    userId: string;
    oldPassword: string;
    newPassword: string;
  }): Promise<string> {
    const user = await client.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new InvalidCredentialsError();

    const ok = await verifyPassword(user.passwordHash, input.oldPassword);
    if (!ok) throw new InvalidCredentialsError();

    const dek = await unwrapDekWithPassword(user, input.oldPassword);

    const [newHash, newWrap] = await Promise.all([
      hashPassword(input.newPassword),
      wrapDek(dek, input.newPassword),
    ]);

    await client.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        contentDekPasswordEnc: newWrap.ciphertext,
        contentDekPasswordIv: newWrap.iv,
        contentDekPasswordAuthTag: newWrap.authTag,
        contentDekPasswordSalt: newWrap.salt,
      },
    });

    // Re-mint ordering is load-bearing: evict ALL sessions (including the
    // caller's) BEFORE opening the fresh one. Opening first would cause the
    // subsequent eviction to immediately nuke the just-minted session.
    closeSessionsForUser(user.id);
    const sessionId = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    openSession({
      sessionId,
      userId: user.id,
      dek,
      createdAt: new Date(now),
      expiresAt: new Date(now + IDLE_TTL_MS),
    });
    return sessionId;
  }

  // [AU17] Authenticated recovery-code rotation. The DEK is unwrapped with
  // the user's current password and then re-wrapped under a freshly-generated
  // recovery code. The old recovery code becomes unusable the instant the
  // DB write commits. Password wrap, password hash, narrative ciphertext, and
  // all active sessions are intentionally untouched — the user is already
  // authenticated and does not need to re-log-in.
  async function rotateRecoveryCode(input: { userId: string; password: string }): Promise<string> {
    const user = await client.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new InvalidCredentialsError();

    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) throw new InvalidCredentialsError();

    const dek = await unwrapDekWithPassword(user, input.password);

    // rewrapRecoveryWrap generates a new random recovery code, derives a new
    // argon2id wrap key from it, re-encrypts the DEK, and writes the four
    // recovery columns atomically via a single UPDATE. Returns the plaintext
    // recovery code that must be shown to the user exactly once.
    return rewrapRecoveryWrap(client, user.id, dek);
  }

  // [AU16] Unauthenticated password reset via recovery code. The DEK is
  // unwrapped with the recovery-code-derived key and then re-wrapped under
  // the new password. Recovery wrap is intentionally not rotated here — if
  // the user also wants a fresh recovery code they call [AU17] afterwards.
  //
  // Username enumeration defence: unknown-user and wrong-code must be
  // indistinguishable. Both paths run unwrapDekWithRecoveryCode exactly once
  // (against a cached dummy wrap on the missing-user branch) and both
  // surface as InvalidCredentialsError to the caller — which the route maps
  // to the same 401 body as a wrong-password login.
  async function resetPassword(input: {
    username: string;
    recoveryCode: string;
    newPassword: string;
  }): Promise<void> {
    const normalisedUsername = input.username.trim().toLowerCase();
    const user = await client.user.findUnique({ where: { username: normalisedUsername } });

    if (!user) {
      try {
        await unwrapDekWithRecoveryCode(await getDummyDekWraps(), input.recoveryCode);
      } catch {
        // expected — dummy wrap never unwraps with caller-supplied code
      }
      throw new InvalidCredentialsError();
    }

    let dek: Buffer;
    try {
      dek = await unwrapDekWithRecoveryCode(user, input.recoveryCode);
    } catch (err) {
      if (err instanceof InvalidRecoveryCodeError) throw new InvalidCredentialsError();
      throw err;
    }

    const [newHash, newWrap] = await Promise.all([
      hashPassword(input.newPassword),
      wrapDek(dek, input.newPassword),
    ]);

    await client.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        contentDekPasswordEnc: newWrap.ciphertext,
        contentDekPasswordIv: newWrap.iv,
        contentDekPasswordAuthTag: newWrap.authTag,
        contentDekPasswordSalt: newWrap.salt,
      },
    });

    closeSessionsForUser(user.id);
  }

  // [B12] Sign out everywhere — evicts every in-memory session for the caller.
  // Idempotent on an empty set.
  async function signOutEverywhere(input: { userId: string }): Promise<void> {
    closeSessionsForUser(input.userId);
  }

  // [X3] Delete account — re-verifies the password (timing-equalised against
  // the unknown-user path the same way login() does), then deletes the user
  // row. Schema cascade drops Story → Chapter → Chat → Message and
  // Story → Character / OutlineItem along with the user record.
  async function deleteAccount(input: { userId: string; password: string }): Promise<void> {
    const user = await client.user.findUnique({ where: { id: input.userId } });

    // Equalise wrong-password vs. unknown-user wall-clock time. Unknown-user
    // shouldn't normally happen on an authenticated route — the session
    // wouldn't validate — but if it does we don't want to leak that via timing.
    const hashForVerify = user?.passwordHash ?? (await getDummyPasswordHash());
    const ok = await verifyPassword(hashForVerify, input.password);
    if (!user || !ok) {
      throw new InvalidCredentialsError();
    }

    await client.user.delete({ where: { id: user.id } });

    closeSessionsForUser(user.id);
  }

  // [X3] / [story-editor-3xj] Update display name. Plaintext metadata; no
  // crypto. Caller has already passed requireAuth so the userId is trusted.
  async function updateProfile(input: { userId: string; name: string }): Promise<PublicUser> {
    const user = await client.user.update({
      where: { id: input.userId },
      data: { name: input.name },
    });
    return toPublicUser(user);
  }

  return {
    register,
    login,
    logout,
    logoutAllSessionsForUser,
    changePassword,
    resetPassword,
    rotateRecoveryCode,
    signOutEverywhere,
    deleteAccount,
    updateProfile,
  };
}

export const authService = createAuthService();
