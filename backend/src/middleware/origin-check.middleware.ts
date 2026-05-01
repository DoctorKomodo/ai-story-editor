import type { NextFunction, Request, Response } from 'express';

/**
 * CSRF defense for cookie-authenticated endpoints.
 *
 * Design context: the only cookie-authed endpoints in this app are
 * `POST /api/auth/refresh` and `POST /api/auth/logout`. All other
 * authenticated routes use `Authorization: Bearer <jwt>`, which a
 * cross-origin attacker cannot set — so they're naturally CSRF-safe.
 *
 * The refresh cookie already has `SameSite=lax` + `path=/api/auth`, which
 * blocks the common CSRF vectors (cross-site `fetch`, hidden iframe, XHR).
 * The remaining gap under `SameSite=lax` is top-level-navigation POSTs —
 * some browsers allow them. This middleware closes that gap by requiring
 * the `Origin` header (or a matching `Referer`) to be the configured
 * frontend origin on any state-changing request.
 *
 * Non-browser clients (curl, supertest, server-to-server, native mobile
 * apps without a WebView origin) typically send neither header; we let
 * those through because CSRF is specifically a browser-context attack
 * and a non-browser caller is not the CSRF threat model.
 *
 * GET/HEAD/OPTIONS are exempt — they should be idempotent. If a handler
 * mutates on GET that's a bug elsewhere, not this middleware's concern.
 */
export function requireAllowedOrigin(allowedOrigin: string) {
  return function originCheckMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
    const referer = typeof req.headers.referer === 'string' ? req.headers.referer : null;

    // Non-browser client: no Origin, no Referer. Modern browsers always
    // attach Origin on cross-origin POSTs (and most same-origin ones), so a
    // request with neither header is very unlikely to be a CSRF attempt
    // from a victim's browser. Let it through; Bearer auth or cookie
    // presence is the real credential.
    if (origin === null && referer === null) {
      next();
      return;
    }

    if (origin === allowedOrigin) {
      next();
      return;
    }

    // Referer fallback. Some legacy flows (e.g. link-clicks through certain
    // proxies) may strip Origin but retain Referer; check with a
    // startsWith+'/' guard so `https://evil.com?victim=https://allowed/…`
    // cannot sneak past a naive prefix match.
    if (referer?.startsWith(`${allowedOrigin}/`)) {
      next();
      return;
    }

    res.status(403).json({ error: { message: 'Origin not allowed', code: 'csrf_block' } });
  };
}
