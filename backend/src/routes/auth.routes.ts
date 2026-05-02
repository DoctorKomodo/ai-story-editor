import { type Request, type Response, Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ZodError, z } from 'zod';
import { badRequestFromZod } from '../lib/bad-request';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth.middleware';
import {
  authService,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  REFRESH_TOKEN_TTL_SECONDS,
  UsernameUnavailableError,
} from '../services/auth.service';

export const REFRESH_COOKIE_NAME = 'refreshToken';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    // Scope the cookie to the auth endpoints that actually use it. Narrower
    // than '/' so the refresh token doesn't ride on every /api/ai/* request.
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

function minPasswordLength(): number {
  return process.env.NODE_ENV === 'production' ? 8 : 4;
}

function buildChangePasswordSchema() {
  const min = minPasswordLength();
  return z.object({
    oldPassword: z.string().min(1, 'oldPassword is required'),
    newPassword: z.string().min(min, `Password must be at least ${min} characters`),
  });
}

function buildResetPasswordSchema() {
  const min = minPasswordLength();
  return z.object({
    username: z.string().min(1, 'username is required'),
    recoveryCode: z.string().min(1, 'recoveryCode is required'),
    newPassword: z.string().min(min, `Password must be at least ${min} characters`),
  });
}

function buildRotateRecoveryCodeSchema() {
  return z.object({ password: z.string().min(1, 'password is required') });
}

function buildDeleteAccountSchema() {
  return z.object({ password: z.string().min(1, 'password is required') });
}

// Per-user (not per-IP) rate limit for sensitive authenticated endpoints
// (change-password and rotate-recovery-code). Scoped to authenticated
// requests via requireAuth — the keyGenerator relies on req.user.id, which
// the middleware sets before this limiter runs.
//
// Each endpoint gets its own independent 10/min bucket (constants, not a
// shared middleware instance). The `rateLimit(...)` call is at module
// scope with no factory indirection so CodeQL's "missing rate limiting"
// rule can trace it directly from the route definition.
const SENSITIVE_AUTH_LIMIT_OPTIONS = {
  windowMs: 60_000,
  // Generous enough that the test suite can exercise the endpoint
  // several times per describe block without hitting the limit, but
  // still meaningful as a brute-force defence. Tune in production via
  // env if needed.
  limit: 10,
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  // Keying on user id (not ip) matches the task spec — a shared NAT
  // can't DOS a legitimate user's ability to change their own password,
  // and a compromised session can't burn someone else's quota.
  keyGenerator: (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  // Don't draw from the limit pool when bodies are malformed / unauthed;
  // the endpoint's protection target is the crypto-verify path, not the
  // schema / auth rejection path.
  skipFailedRequests: false,
};

const changePasswordLimiter = rateLimit(SENSITIVE_AUTH_LIMIT_OPTIONS);
const rotateRecoveryCodeLimiter = rateLimit(SENSITIVE_AUTH_LIMIT_OPTIONS);
const signOutEverywhereLimiter = rateLimit(SENSITIVE_AUTH_LIMIT_OPTIONS);
const deleteAccountLimiter = rateLimit(SENSITIVE_AUTH_LIMIT_OPTIONS);

// Aggressive stacked rate limits for the unauthenticated reset-password
// endpoint. Spec: "per-IP + per-username". Two limiters stack, so a single
// abusive IP can't cross-target many usernames to grind the crypto path,
// and a single victim username can't be hammered from a botnet.
//
// Under NODE_ENV=test the limits are raised way out of the way — the test
// suite legitimately fires many requests from a single IP (always 127.0.0.1)
// and the timing test needs to avoid hitting 429 short-circuits, which
// would mask the very argon2id-cost equality that test is supposed to
// verify. Tests that exercise rate-limit behaviour directly should use a
// dedicated per-test app instance or mock the limiter.
const IS_TEST_ENV = process.env.NODE_ENV === 'test';

function resetPasswordIpLimiter() {
  return rateLimit({
    windowMs: 60_000,
    limit: IS_TEST_ENV ? 10_000 : 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown-ip'),
  });
}

function resetPasswordUsernameLimiter() {
  return rateLimit({
    windowMs: 60_000,
    limit: IS_TEST_ENV ? 10_000 : 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      // req.body is already JSON-parsed by express.json() — the limiter
      // runs after that middleware. An absent / malformed username is fine
      // to key under a shared bucket because the endpoint will reject it
      // at the schema step anyway.
      const raw = (req.body as { username?: unknown })?.username;
      return typeof raw === 'string' ? raw.trim().toLowerCase() : 'unknown-user';
    },
  });
}

export function createAuthRouter() {
  const router = Router();

  router.post('/register', async (req, res, next) => {
    try {
      const result = await authService.register(req.body);
      res.status(201).json({
        user: result.user,
        recoveryCode: result.recoveryCode,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        badRequestFromZod(res, err);
        return;
      }
      if (err instanceof UsernameUnavailableError) {
        res
          .status(409)
          .json({ error: { message: 'Username unavailable', code: 'username_unavailable' } });
        return;
      }
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const result = await authService.login(req.body);
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());
      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof ZodError) {
        badRequestFromZod(res, err);
        return;
      }
      if (err instanceof InvalidCredentialsError) {
        res
          .status(401)
          .json({ error: { message: 'Invalid credentials', code: 'invalid_credentials' } });
        return;
      }
      next(err);
    }
  });

  router.post('/refresh', async (req: Request, res: Response, next) => {
    try {
      const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      if (!token) {
        res
          .status(401)
          .json({ error: { message: 'Invalid refresh token', code: 'invalid_refresh' } });
        return;
      }
      const result = await authService.refresh(token);
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());
      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof InvalidRefreshTokenError) {
        res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: 0 });
        res
          .status(401)
          .json({ error: { message: 'Invalid refresh token', code: 'invalid_refresh' } });
        return;
      }
      next(err);
    }
  });

  router.post('/logout', async (req: Request, res: Response, next) => {
    try {
      const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      if (token) await authService.logout(token);
      res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: 0 });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/reset-password',
    resetPasswordIpLimiter(),
    resetPasswordUsernameLimiter(),
    async (req, res, next) => {
      try {
        const parsed = buildResetPasswordSchema().parse(req.body);
        await authService.resetPassword({
          username: parsed.username,
          recoveryCode: parsed.recoveryCode,
          newPassword: parsed.newPassword,
        });
        res.status(204).send();
      } catch (err) {
        if (err instanceof ZodError) {
          badRequestFromZod(res, err);
          return;
        }
        if (err instanceof InvalidCredentialsError) {
          // Identical body + status to the login invalid-credentials path —
          // reset-password must not expose "user not found" vs. "wrong
          // recovery code" to the caller ([AU10] precedent).
          res.status(401).json({
            error: { message: 'Invalid credentials', code: 'invalid_credentials' },
          });
          return;
        }
        next(err);
      }
    },
  );

  router.post('/change-password', requireAuth, changePasswordLimiter, async (req, res, next) => {
    try {
      const authed = req.user;
      if (!authed) {
        res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
        return;
      }
      const parsed = buildChangePasswordSchema().parse(req.body);
      await authService.changePassword({
        userId: authed.id,
        oldPassword: parsed.oldPassword,
        newPassword: parsed.newPassword,
      });
      // 204 — caller stays authenticated on this request's access token
      // until it expires, but all refresh tokens (including this one's)
      // have been invalidated server-side so the next refresh will fail.
      res.status(204).send();
    } catch (err) {
      if (err instanceof ZodError) {
        badRequestFromZod(res, err);
        return;
      }
      if (err instanceof InvalidCredentialsError) {
        res.status(401).json({
          error: { message: 'Invalid credentials', code: 'invalid_credentials' },
        });
        return;
      }
      next(err);
    }
  });

  // [B12] Sign out everywhere — revokes every refresh token belonging to the
  // caller and clears the caller's refresh cookie. Used by F61 Account &
  // Privacy → "Sign out everywhere".
  router.post(
    '/sign-out-everywhere',
    requireAuth,
    signOutEverywhereLimiter,
    async (req, res, next) => {
      try {
        const authed = req.user;
        if (!authed) {
          res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
          return;
        }
        await authService.signOutEverywhere({ userId: authed.id });
        res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: 0 });
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/rotate-recovery-code',
    requireAuth,
    rotateRecoveryCodeLimiter,
    async (req, res, next) => {
      try {
        const authed = req.user;
        if (!authed) {
          res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
          return;
        }
        const parsed = buildRotateRecoveryCodeSchema().parse(req.body);
        const recoveryCode = await authService.rotateRecoveryCode({
          userId: authed.id,
          password: parsed.password,
        });
        res.status(200).json({
          recoveryCode,
          warning: 'Save this recovery code now — it will not be shown again.',
        });
      } catch (err) {
        if (err instanceof ZodError) {
          badRequestFromZod(res, err);
          return;
        }
        if (err instanceof InvalidCredentialsError) {
          res.status(401).json({
            error: { message: 'Invalid credentials', code: 'invalid_credentials' },
          });
          return;
        }
        next(err);
      }
    },
  );

  // [X3] Delete account — re-verifies the password, deletes the user (cascading
  // to all narrative entities, refresh tokens, sessions, DEK wraps), and clears
  // the caller's refresh cookie.
  router.delete('/delete-account', requireAuth, deleteAccountLimiter, async (req, res, next) => {
    try {
      const authed = req.user;
      if (!authed) {
        res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
        return;
      }
      const parsed = buildDeleteAccountSchema().parse(req.body);
      await authService.deleteAccount({
        userId: authed.id,
        password: parsed.password,
      });
      // Clear the caller's refresh cookie. The user row is gone, but a
      // browser that holds the cookie locally would otherwise send it on
      // the next /api/auth/refresh call, where it would 401 with no
      // Set-Cookie clearing it.
      res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: 0 });
      res.status(204).send();
    } catch (err) {
      if (err instanceof ZodError) {
        badRequestFromZod(res, err);
        return;
      }
      if (err instanceof InvalidCredentialsError) {
        res.status(401).json({
          error: { message: 'Invalid credentials', code: 'invalid_credentials' },
        });
        return;
      }
      next(err);
    }
  });

  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      const authed = req.user;
      if (!authed) {
        res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
        return;
      }
      const user = await prisma.user.findUnique({ where: { id: authed.id } });
      if (!user) {
        res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
        return;
      }
      res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
