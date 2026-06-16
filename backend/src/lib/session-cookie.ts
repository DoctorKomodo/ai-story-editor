import type { CookieOptions } from 'express';
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
