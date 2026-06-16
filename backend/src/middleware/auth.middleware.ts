import type { NextFunction, Request, Response } from 'express';
import { sessionCookieName, sessionCookieOptions } from '../lib/session-cookie';
import { attachDekToRequest } from '../services/content-crypto.service';
import {
  extendSessionExpiry,
  getSession,
  IDLE_TTL_MS,
  peekSessionExpiry,
} from '../services/session-store';

// Only re-issue the cookie when it is within ~24h of expiring, to avoid a
// Set-Cookie on every single response (including SSE streams).
const COOKIE_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const name = sessionCookieName();
  const sessionId = (req.cookies?.[name] as string | undefined) ?? null;
  if (!sessionId) {
    res.status(401).json({ error: { message: 'Unauthorized', code: 'unauthorized' } });
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    // Cookie present but no live session: process restarted, entry evicted,
    // or session was explicitly revoked. Surface a distinct code so the frontend
    // can show "please sign in again" instead of a generic Unauthorized.
    res.status(401).json({ error: { message: 'Session expired', code: 'session_expired' } });
    return;
  }

  req.user = { id: session.userId, sessionId };
  attachDekToRequest(req, session.dek);

  // Slide the idle TTL (clamped to the absolute cap inside extendSessionExpiry).
  // Capture the pre-slide expiry first: that's what the browser's cookie has,
  // and it's what tells us whether the browser needs a refreshed cookie. If the
  // cookie the browser is holding is within ~24h of expiring we re-issue it
  // with the post-slide maxAge so it stays alive. Set BEFORE next() so it
  // precedes any streamed body (SSE).
  const now = Date.now();
  const preSlideExpiry = peekSessionExpiry(sessionId);
  extendSessionExpiry(sessionId, new Date(now + IDLE_TTL_MS));
  const postSlideExpiry = peekSessionExpiry(sessionId);
  if (
    preSlideExpiry !== null &&
    preSlideExpiry - now < COOKIE_REFRESH_THRESHOLD_MS &&
    postSlideExpiry !== null
  ) {
    res.cookie(name, sessionId, sessionCookieOptions(Math.max(0, postSlideExpiry - now)));
  }

  next();
}
