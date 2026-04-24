import { type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { AuthenticationError, mapVeniceError } from '../lib/venice-errors';
import { requireAuth } from '../middleware/auth.middleware';
import {
  VeniceKeyCheckError,
  VeniceKeyInvalidError,
  veniceKeyService,
} from '../services/venice-key.service';

// [V18] Per-user rate limiter for the verify endpoint.
// Keyed by user id (not IP) so multiple users behind the same NAT don't starve
// each other. windowMs is injectable so tests can use a shorter window.
export function createVerifyRateLimiter(windowMs = 60_000) {
  return rateLimit({
    windowMs,
    limit: 6,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Key by authenticated user id. Falls back to IP when no user (e.g. if
    // the middleware order is somehow wrong — the auth middleware already
    // runs before this limiter, so req.user should always be present here).
    keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'anon',
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: 'verify_rate_limited',
          message: 'Too many verification attempts. Try again in a moment.',
        },
      });
    },
  });
}

function badRequestFromZod(res: Response, err: ZodError): Response {
  return res.status(400).json({
    error: {
      message: 'Invalid request body',
      code: 'validation_error',
      issues: err.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    },
  });
}

export interface VeniceKeyRouterOptions {
  // Allows tests to inject a short windowMs for the verify rate limiter
  // without having to stub timers. Production always uses the default 60 s.
  verifyRateLimitWindowMs?: number;
}

export function createVeniceKeyRouter(options: VeniceKeyRouterOptions = {}) {
  const router = Router();

  // All endpoints in this router operate on the caller's own record only.
  // "Ownership of self" — req.user.id is the only id used.
  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next) => {
    try {
      const status = await veniceKeyService.getStatus(req.user!.id);
      res.status(200).json(status);
    } catch (err) {
      next(err);
    }
  });

  router.put('/', async (req: Request, res: Response, next) => {
    try {
      const status = await veniceKeyService.store(req.user!.id, req.body);
      res.status(200).json({
        status: 'saved',
        lastFour: status.lastFour,
        endpoint: status.endpoint,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        badRequestFromZod(res, err);
        return;
      }
      if (err instanceof VeniceKeyInvalidError) {
        res
          .status(400)
          .json({ error: { message: 'venice_key_invalid', code: 'venice_key_invalid' } });
        return;
      }
      if (err instanceof VeniceKeyCheckError) {
        res
          .status(502)
          .json({ error: { message: 'venice_unreachable', code: 'venice_unreachable' } });
        return;
      }
      next(err);
    }
  });

  router.delete('/', async (req: Request, res: Response, next) => {
    try {
      await veniceKeyService.remove(req.user!.id);
      res.status(200).json({ status: 'removed' });
    } catch (err) {
      next(err);
    }
  });

  // [V18] POST /verify — re-validates the stored key against Venice and returns
  // balance info. Rate-limited per user (6 req/min) to prevent Venice abuse.
  // AuthenticationError from the SDK (stored key was revoked) is mapped to a
  // successful 200 with verified:false — NOT an error response — because the
  // Settings UI must show "Not verified" without treating it as a crash.
  router.post(
    '/verify',
    createVerifyRateLimiter(options.verifyRateLimitWindowMs),
    async (req: Request, res: Response, next) => {
      const userId = req.user!.id;
      try {
        const result = await veniceKeyService.verify(userId);
        res.status(200).json(result);
      } catch (err) {
        // 401 from Venice — the stored key was rejected. Return verified:false
        // with the key metadata echoed back so the Settings pill can display
        // "Not verified · last four: XXXX". Don't use mapVeniceError here
        // because that would return HTTP 400; we want 200 for this case.
        if (err instanceof AuthenticationError) {
          // Fetch status to include endpoint/lastFour even on bad-key response.
          // We already called getStatus inside verify(), but verify throws
          // before we can read those values — fetch them here.
          try {
            const status = await veniceKeyService.getStatus(userId);
            res.status(200).json({
              verified: false,
              credits: null,
              diem: null,
              endpoint: status.endpoint,
              lastFour: status.lastFour,
            });
          } catch {
            // If getStatus itself fails, return minimal verified:false response.
            res
              .status(200)
              .json({ verified: false, credits: null, diem: null, endpoint: null, lastFour: null });
          }
          return;
        }
        // RateLimitError, 5xx, etc. — delegate to mapVeniceError then global handler.
        if (mapVeniceError(err, res, userId)) return;
        next(err);
      }
    },
  );

  return router;
}
