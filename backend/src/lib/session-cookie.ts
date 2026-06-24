import type { CookieOptions, Response } from 'express';
import { ABSOLUTE_TTL_MS } from '../services/session-store';

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

// __Host- requires Secure + Path=/ + no Domain, which only holds over HTTPS (or
// localhost). In dev a LAN-IP / custom-host setup is not a secure context, so
// we use a plain, non-Secure cookie there. See spec Decision 5.
export function sessionCookieName(): string {
  return isProd() ? '__Host-session' : 'session';
}

export function sessionCookieOptions(maxAgeMs: number = ABSOLUTE_TTL_MS): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

// Single issuance point so every set-cookie path (login, change-password,
// sliding re-issue) stays in sync. Defaults the lifetime to the absolute cap;
// the sliding-expiry middleware passes the remaining-to-cap maxAge explicitly.
export function setSessionCookie(
  res: Response,
  sessionId: string,
  maxAgeMs: number = ABSOLUTE_TTL_MS,
): void {
  res.cookie(sessionCookieName(), sessionId, sessionCookieOptions(maxAgeMs));
}

// Single revocation point. The clear options must match the original cookie's
// name/path/attributes (notably for the `__Host-` prefix) for the browser to
// drop it, so all logout paths route through here.
export function clearSessionCookie(res: Response): void {
  res.clearCookie(sessionCookieName(), { ...sessionCookieOptions(), maxAge: 0 });
}
