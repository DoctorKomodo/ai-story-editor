// [X32] GET /api/users/me/venice-account — unified Venice account-info probe.
//
// Replaces the old GET /api/ai/balance (V10) and POST /api/users/me/venice-key/
// verify (V18). Returns { verified, balanceUsd, diem, endpoint, lastSix } from
// Venice's GET /api_keys/rate_limits body.
//
// Mounted as a sibling of /venice-key — semantically this is about the *account*
// (balance + verification), not the key (CRUD).

import { type Request, type Response, Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.middleware';
import {
  VeniceAccountRateLimitedError,
  VeniceAccountUnavailableError,
  veniceKeyService,
} from '../services/venice-key.service';

// Per-user rate limiter for the account-info endpoint. 30 req/min/user is
// generous enough that no real user (header pill mount + Settings clicks)
// trips it, tight enough that a runaway client gets cut off before Venice
// notices. windowMs is injectable so tests can compress the window.
export function createAccountRateLimiter(windowMs = 60_000) {
  return rateLimit({
    windowMs,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'anon'),
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: 'account_rate_limited',
          message: 'Too many account-info requests. Try again in a moment.',
        },
      });
    },
  });
}

export interface VeniceAccountRouterOptions {
  // Allows tests to inject a short windowMs without stubbing timers.
  // Production always uses the default 60 s.
  accountRateLimitWindowMs?: number;
}

export function createVeniceAccountRouter(options: VeniceAccountRouterOptions = {}) {
  const router = Router();

  router.use(requireAuth);

  router.get(
    '/',
    createAccountRateLimiter(options.accountRateLimitWindowMs),
    async (req: Request, res: Response, next) => {
      const userId = req.user!.id;
      try {
        const result = await veniceKeyService.getAccount(userId);
        res.status(200).json(result);
      } catch (err) {
        if (err instanceof VeniceAccountRateLimitedError) {
          res.status(429).json({
            error: {
              code: 'venice_rate_limited',
              message: 'Venice is rate limiting this request. Try again shortly.',
              retryAfterSeconds: err.retryAfterSeconds,
              upstreamStatus: err.upstreamStatus,
            },
          });
          return;
        }
        if (err instanceof VeniceAccountUnavailableError) {
          res.status(502).json({
            error: {
              code: 'venice_unavailable',
              message: 'Venice is temporarily unavailable. Try again shortly.',
              upstreamStatus: err.upstreamStatus,
            },
          });
          return;
        }
        next(err);
      }
    },
  );

  return router;
}
