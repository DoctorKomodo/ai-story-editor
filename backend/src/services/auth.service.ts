import crypto from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { prisma as defaultPrisma } from '../lib/prisma';
import { ARGON2_PARAMS } from './argon2.config';
import {
  generateDekAndWraps,
  InvalidRecoveryCodeError,
  rewrapRecoveryWrap,
  unwrapDekWithPassword,
  unwrapDekWithRecoveryCode,
  wrapDek,
  type UserDekColumns,
} from './content-crypto.service';
import {
  closeSession,
  closeSessionsForUser,
  extendSessionExpiry,
  getSession,
  openSession,
} from './session-store';

// bcrypt rounds retained only for verifying legacy bcrypt hashes during the
// argon2 migration ([AU14]) — new passwords always hash with argon2id.
export const BCRYPT_ROUNDS = 12;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

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

export interface PasswordVerifyResult {
  ok: boolean;
  // True when a successful match used a legacy hash scheme that should be
  // silently re-hashed with the current ARGON2_PARAMS on next write.
  needsRehash: boolean;
}

export async function verifyPassword(hash: string, password: string): Promise<PasswordVerifyResult> {
  if (hash.startsWith('$argon2')) {
    try {
      // argon2.verify reads m/t/p from the hash string and does NOT consult
      // ARGON2_PARAMS (only the optional `secret` field is used). Use
      // argon2.needsRehash separately to detect param drift so a future bump
      // to ARGON2_PARAMS triggers silent migration on the next login.
      const ok = await argon2.verify(hash, password);
      if (!ok) return { ok: false, needsRehash: false };
      const needsRehash = argon2.needsRehash(hash, ARGON2_PARAMS);
      return { ok: true, needsRehash };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }
  if (hash.startsWith('$2')) {
    // Legacy bcryptjs hash from pre-[AU14] registrations. On successful match
    // we flag for rehash so the next write upgrades the stored hash to argon2.
    const ok = await bcrypt.compare(password, hash);
    return { ok, needsRehash: ok };
  }
  // Unknown / corrupt hash format: fail closed.
  return { ok: false, needsRehash: false };
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

const nameSchema = z
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

export interface LoginResult {
  user: PublicUser;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface AccessTokenPayload {
  sub: string;
  email: string | null;
  username?: string;
  // [E3] session id — present on tokens issued after E3 rollout. Middleware
  // uses it to look up the unwrapped DEK from the session store. Tokens
  // issued before E3 (or in auth-only tests that bypass login()) carry no
  // sessionId and simply have no DEK attached to the request.
  sessionId?: string;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
  // [E3] session id — binds this refresh token to the DEK-holding session
  // in session-store. Refresh reuses the same sessionId; logout destroys it.
  sessionId?: string;
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

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('Invalid refresh token');
    this.name = 'InvalidRefreshTokenError';
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

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in the backend .env before calling auth.service.`,
    );
  }
  return value;
}

function signAccessToken(user: User, sessionId?: string): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    email: user.email,
    username: user.username,
  };
  if (sessionId) payload.sessionId = sessionId;
  const options: SignOptions = { expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  return jwt.sign(payload, getRequiredEnv('JWT_SECRET'), options);
}

function signRefreshToken(user: User, sessionId?: string): string {
  const payload: RefreshTokenPayload = {
    sub: user.id,
    jti: crypto.randomBytes(16).toString('hex'),
    type: 'refresh',
  };
  if (sessionId) payload.sessionId = sessionId;
  const options: SignOptions = { expiresIn: REFRESH_TOKEN_TTL_SECONDS };
  return jwt.sign(payload, getRequiredEnv('REFRESH_TOKEN_SECRET'), options);
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
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
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
    const { ok: passwordMatches, needsRehash } = await verifyPassword(
      passwordHashForVerify,
      input.password,
    );

    if (!user || !passwordMatches) {
      throw new InvalidCredentialsError();
    }

    // [AU14] migration: if the stored hash is a legacy bcrypt hash, upgrade
    // it to argon2id inside the same request. Failure to rehash must not fail
    // the login — the user still has a valid password; the upgrade simply
    // retries next time.
    if (needsRehash) {
      try {
        const upgraded = await hashPassword(input.password);
        await client.user.update({
          where: { id: user.id },
          data: { passwordHash: upgraded },
        });
      } catch {
        // Swallow — migration is best-effort.
      }
    }

    // [E3] Unwrap the content DEK with the now-verified password. Users
    // registered before [E3] may lack wrap columns; lazily generate them on
    // the first post-[E3] login when the password is available.
    let dek: Buffer;
    if (user.contentDekPasswordEnc) {
      dek = await unwrapDekWithPassword(user, input.password);
    } else {
      const generated = await generateDekAndWraps(input.password);
      await client.user.update({
        where: { id: user.id },
        data: {
          contentDekPasswordEnc: generated.passwordWrap.ciphertext,
          contentDekPasswordIv: generated.passwordWrap.iv,
          contentDekPasswordAuthTag: generated.passwordWrap.authTag,
          contentDekPasswordSalt: generated.passwordWrap.salt,
          contentDekRecoveryEnc: generated.recoveryWrap.ciphertext,
          contentDekRecoveryIv: generated.recoveryWrap.iv,
          contentDekRecoveryAuthTag: generated.recoveryWrap.authTag,
          contentDekRecoverySalt: generated.recoveryWrap.salt,
        },
      });
      dek = generated.dek;
      // NOTE: the lazy-generated recoveryCode is NOT surfaced — the user
      // never sees it. They'll need to rotate via [AU17] on first use to
      // receive a code they can write down. Documented in [E10].
    }

    const now = Date.now();
    const accessTokenExpiresAt = new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000);
    const refreshTokenExpiresAt = new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000);

    // Persist the session row + refresh token FIRST; only then expose the
    // DEK in-memory. A write failure leaves no orphaned map entry consuming
    // a slot against the session-store cap.
    const sessionId = crypto.randomBytes(32).toString('hex');
    const accessToken = signAccessToken(user, sessionId);
    const refreshToken = signRefreshToken(user, sessionId);

    await client.$transaction([
      client.session.create({
        data: { id: sessionId, userId: user.id, expiresAt: refreshTokenExpiresAt },
      }),
      client.refreshToken.create({
        data: {
          token: refreshToken,
          userId: user.id,
          expiresAt: refreshTokenExpiresAt,
        },
      }),
    ]);

    openSession({ sessionId, userId: user.id, dek, expiresAt: refreshTokenExpiresAt });

    return {
      user: toPublicUser(user),
      accessToken,
      accessTokenExpiresAt,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  async function refresh(rawToken: unknown): Promise<LoginResult> {
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw new InvalidRefreshTokenError();
    }

    // 1) Signature + expiry check via JWT. We don't trust the payload beyond
    //    shape — DB lookup is the canonical validation.
    let payload: RefreshTokenPayload;
    try {
      const decoded = jwt.verify(rawToken, getRequiredEnv('REFRESH_TOKEN_SECRET'), {
        algorithms: ['HS256'],
      });
      if (
        typeof decoded !== 'object' ||
        decoded === null ||
        (decoded as RefreshTokenPayload).type !== 'refresh' ||
        typeof (decoded as RefreshTokenPayload).sub !== 'string'
      ) {
        throw new InvalidRefreshTokenError();
      }
      payload = decoded as RefreshTokenPayload;
    } catch (err) {
      if (err instanceof InvalidRefreshTokenError) throw err;
      throw new InvalidRefreshTokenError();
    }

    // 2) DB lookup — must be present and unexpired.
    const stored = await client.refreshToken.findUnique({ where: { token: rawToken } });
    if (!stored || stored.userId !== payload.sub || stored.expiresAt.getTime() <= Date.now()) {
      throw new InvalidRefreshTokenError();
    }

    const user = await client.user.findUnique({ where: { id: stored.userId } });
    if (!user) {
      // Orphaned token — clean it up and refuse.
      await client.refreshToken.deleteMany({ where: { token: rawToken } });
      throw new InvalidRefreshTokenError();
    }

    // 3) [E3] The session must still exist in-memory. If the process
    //    restarted or the session was evicted, the DEK is gone and the user
    //    must re-authenticate with their password. Signal this the same way
    //    as any other invalid refresh — 401 + clear cookie — so the frontend
    //    routes to /login and prompts for the password again.
    const sessionId = payload.sessionId;
    if (sessionId) {
      const session = getSession(sessionId);
      if (!session || session.userId !== user.id) {
        // Session lost; clean the orphaned refresh token and session row.
        await Promise.all([
          client.refreshToken.deleteMany({ where: { id: stored.id } }),
          client.session.deleteMany({ where: { id: sessionId } }),
        ]);
        throw new InvalidRefreshTokenError();
      }
    }

    // 4) Atomic rotation: delete the old refresh row + create the new row in
    //    one tx. Any subsequent reuse of the old token will miss the DB lookup
    //    above. The sessionId stays the same — refresh extends a session, it
    //    doesn't open a new one.
    const newRefreshToken = signRefreshToken(user, sessionId);
    const now = Date.now();
    const refreshTokenExpiresAt = new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000);

    try {
      await client.$transaction([
        client.refreshToken.delete({ where: { id: stored.id } }),
        client.refreshToken.create({
          data: {
            token: newRefreshToken,
            userId: user.id,
            expiresAt: refreshTokenExpiresAt,
          },
        }),
      ]);
    } catch (err) {
      // Concurrent refresh: a sibling call already rotated this token. The
      // delete step throws P2025 (record-not-found). Surface as an ordinary
      // invalid-refresh so the route clears the cookie and the client is
      // routed to /login, matching the single-use semantics of refresh.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new InvalidRefreshTokenError();
      }
      throw err;
    }

    if (sessionId) {
      await client.session.updateMany({
        where: { id: sessionId },
        data: { expiresAt: refreshTokenExpiresAt },
      });
      extendSessionExpiry(sessionId, refreshTokenExpiresAt);
    }

    const accessToken = signAccessToken(user, sessionId);
    const accessTokenExpiresAt = new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000);

    return {
      user: toPublicUser(user),
      accessToken,
      accessTokenExpiresAt,
      refreshToken: newRefreshToken,
      refreshTokenExpiresAt,
    };
  }

  async function logout(rawToken: unknown): Promise<void> {
    // Logout is best-effort: any parse / verify failure is swallowed because
    // the user is going away anyway. What we DO care about is tearing down
    // server-side state — the refresh-token row, the session row, and the
    // in-memory DEK cache — so a lost / stolen cookie can't be replayed after
    // the user clicks "log out".
    if (typeof rawToken !== 'string' || rawToken.length === 0) return;
    let payload: RefreshTokenPayload | null = null;
    try {
      const decoded = jwt.verify(rawToken, getRequiredEnv('REFRESH_TOKEN_SECRET'), {
        algorithms: ['HS256'],
      });
      if (
        typeof decoded === 'object' &&
        decoded !== null &&
        (decoded as RefreshTokenPayload).type === 'refresh' &&
        typeof (decoded as RefreshTokenPayload).sub === 'string'
      ) {
        payload = decoded as RefreshTokenPayload;
      }
    } catch {
      // Ignore — we'll still delete any row matching the raw token below.
    }

    await client.refreshToken.deleteMany({ where: { token: rawToken } });
    if (payload?.sessionId) {
      closeSession(payload.sessionId);
      await client.session.deleteMany({ where: { id: payload.sessionId } });
    }
  }

  async function logoutAllSessionsForUser(userId: string): Promise<void> {
    // Used by password-change / password-reset ([AU15] / [AU16]).
    closeSessionsForUser(userId);
    await Promise.all([
      client.refreshToken.deleteMany({ where: { userId } }),
      client.session.deleteMany({ where: { userId } }),
    ]);
  }

  // [AU15] Authenticated password change. Rewraps the content DEK under the
  // new password — narrative ciphertext is untouched. Invalidates all
  // sessions + refresh tokens so any other logged-in device is forced
  // through /login again (where it will re-derive the wrap key from the
  // new password). The recovery wrap is intentionally not rotated here;
  // rotating the recovery code is a separate, explicit user action ([AU17]).
  async function changePassword(input: {
    userId: string;
    oldPassword: string;
    newPassword: string;
  }): Promise<void> {
    const user = await client.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new InvalidCredentialsError();

    const { ok } = await verifyPassword(user.passwordHash, input.oldPassword);
    if (!ok) throw new InvalidCredentialsError();

    const dek = await unwrapDekWithPassword(user, input.oldPassword);

    const [newHash, newWrap] = await Promise.all([
      hashPassword(input.newPassword),
      wrapDek(dek, input.newPassword),
    ]);

    await client.$transaction([
      client.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          contentDekPasswordEnc: newWrap.ciphertext,
          contentDekPasswordIv: newWrap.iv,
          contentDekPasswordAuthTag: newWrap.authTag,
          contentDekPasswordSalt: newWrap.salt,
        },
      }),
      client.refreshToken.deleteMany({ where: { userId: user.id } }),
      client.session.deleteMany({ where: { userId: user.id } }),
    ]);

    // In-memory session map eviction is separate from the DB write — a
    // stale in-memory entry on another request thread would let an already
    // authenticated request keep its DEK for up to one more hop. Do this
    // after the DB tx commits so we never evict in-memory state that the
    // DB still claims is valid.
    closeSessionsForUser(user.id);
  }

  // [AU17] Authenticated recovery-code rotation. The DEK is unwrapped with
  // the user's current password and then re-wrapped under a freshly-generated
  // recovery code. The old recovery code becomes unusable the instant the
  // DB write commits. Password wrap, password hash, narrative ciphertext, and
  // all active refresh tokens / sessions are intentionally untouched — the
  // user is already authenticated and does not need to re-log-in.
  async function rotateRecoveryCode(input: {
    userId: string;
    password: string;
  }): Promise<string> {
    const user = await client.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new InvalidCredentialsError();

    const { ok } = await verifyPassword(user.passwordHash, input.password);
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

    await client.$transaction([
      client.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          contentDekPasswordEnc: newWrap.ciphertext,
          contentDekPasswordIv: newWrap.iv,
          contentDekPasswordAuthTag: newWrap.authTag,
          contentDekPasswordSalt: newWrap.salt,
        },
      }),
      client.refreshToken.deleteMany({ where: { userId: user.id } }),
      client.session.deleteMany({ where: { userId: user.id } }),
    ]);

    closeSessionsForUser(user.id);
  }

  return {
    register,
    login,
    refresh,
    logout,
    logoutAllSessionsForUser,
    changePassword,
    resetPassword,
    rotateRecoveryCode,
  };
}

export const authService = createAuthService();
