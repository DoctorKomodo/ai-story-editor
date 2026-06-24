import type { NextFunction, Request, Response } from 'express';

/**
 * Primary CSRF defense for all cookie-authenticated API routes.
 *
 * Every mutating request (POST / PUT / PATCH / DELETE) must carry either a
 * matching `Origin` header or a `Referer` that starts with an allowed origin
 * followed by `/`. Requests with neither are blocked with 403 `csrf_block`.
 *
 * This is the OWASP-recommended default-deny stance: "If neither of these
 * headers are present, we recommend blocking the request." Real browsers
 * always attach `Origin` on cross-origin requests and on most same-origin
 * ones too — a legitimate same-origin SPA POST will never lack it.
 * Non-browser automation (curl, scripts, server-to-server calls) must
 * explicitly send `Origin: <allowedOrigin>` to reach these endpoints.
 *
 * The `SameSite=Lax` session cookie already blocks the common CSRF vectors
 * (cross-site fetch, iframe, XHR), but top-level-navigation POSTs can still
 * slip through in some browsers. This middleware closes that gap.
 *
 * The `Referer` branch uses a `startsWith(`${o}/`)` guard (note the trailing
 * slash) so that a sibling-domain prefix like `https://allowed.example.evil.com/`
 * cannot sneak past a naive `startsWith('https://allowed.example')` match.
 *
 * GET/HEAD/OPTIONS are exempt — they must be idempotent. A handler that
 * mutates on GET is a bug in that handler, not this middleware's concern.
 */
export function requireAllowedOrigin(allowedOrigin: string | readonly string[]) {
  const allowedOrigins = Array.isArray(allowedOrigin) ? [...allowedOrigin] : [allowedOrigin];
  return function originCheckMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
    const referer = typeof req.headers.referer === 'string' ? req.headers.referer : null;

    if (origin !== null && allowedOrigins.includes(origin)) {
      next();
      return;
    }

    // Referer fallback. Some legacy flows (e.g. link-clicks through certain
    // proxies) may strip Origin but retain Referer; check with a
    // startsWith+'/' guard so a sibling-domain prefix like
    // `https://allowed.example.evil.com/` cannot sneak past a naive prefix match.
    if (referer !== null && allowedOrigins.some((o) => referer.startsWith(`${o}/`))) {
      next();
      return;
    }

    res.status(403).json({ error: { message: 'Origin not allowed', code: 'csrf_block' } });
  };
}
