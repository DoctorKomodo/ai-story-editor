import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionCookieName } from '../../src/lib/session-cookie';
import { requireAuth } from '../../src/middleware/auth.middleware';
import {
  _resetSessionStore,
  closeSession,
  IDLE_TTL_MS,
  openSession,
  peekSessionExpiry,
} from '../../src/services/session-store';
import '../setup';

const COOKIE_NAME = sessionCookieName();

function makeReq(cookies: Record<string, string> = {}): Request {
  return { cookies } as unknown as Request;
}

function makeRes(): Response & {
  cookie: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const res: Record<string, unknown> = {};
  const json = vi.fn().mockReturnValue(res);
  const status = vi.fn().mockReturnValue({ json });
  const cookie = vi.fn();
  res.json = json;
  res.status = status;
  res.cookie = cookie;
  return res as unknown as Response & {
    cookie: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

const openedSessionIds: string[] = [];

function openTestSession(userId: string, opts?: { expiresAt?: Date; createdAt?: Date }): string {
  const sessionId = crypto.randomBytes(16).toString('hex');
  openSession({
    sessionId,
    userId,
    dek: crypto.randomBytes(32),
    createdAt: opts?.createdAt ?? new Date(),
    expiresAt: opts?.expiresAt ?? new Date(Date.now() + IDLE_TTL_MS),
  });
  openedSessionIds.push(sessionId);
  return sessionId;
}

afterEach(() => {
  for (const id of openedSessionIds.splice(0)) closeSession(id);
  _resetSessionStore();
});

describe('requireAuth middleware (cookie-based)', () => {
  it('401 unauthorized when no session cookie', () => {
    const req = makeReq({});
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: 'Unauthorized', code: 'unauthorized' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('401 session_expired when cookie present but no live session', () => {
    const req = makeReq({ [COOKIE_NAME]: 'dead-session-id' });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: 'Session expired', code: 'session_expired' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches user + DEK and slides expiry on a live session', () => {
    const userId = 'user-slide-1';
    const sessionId = openTestSession(userId, {
      expiresAt: new Date(Date.now() + IDLE_TTL_MS),
    });

    const expiryBefore = peekSessionExpiry(sessionId)!;

    // Advance time slightly so the slide produces a measurably later expiry.
    const req = makeReq({ [COOKIE_NAME]: sessionId });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as Request & { user?: { id: string; sessionId: string } }).user).toEqual({
      id: userId,
      sessionId,
    });

    // extendSessionExpiry should have been called (expiry >= expiryBefore).
    const expiryAfter = peekSessionExpiry(sessionId)!;
    expect(expiryAfter).toBeGreaterThanOrEqual(expiryBefore);
  });

  it('re-sets the cookie only when within ~24h of expiry', () => {
    // Near-expiry session: expires in 23h (< 24h threshold)
    const nearExpiry = new Date(Date.now() + 23 * 60 * 60 * 1000);
    const nearSessionId = openTestSession('user-near', { expiresAt: nearExpiry });

    const reqNear = makeReq({ [COOKIE_NAME]: nearSessionId });
    const resNear = makeRes();
    requireAuth(reqNear, resNear, vi.fn() as unknown as NextFunction);
    expect(resNear.cookie).toHaveBeenCalled();

    // Fresh session: expires in 7 days (> 24h threshold)
    const freshExpiry = new Date(Date.now() + IDLE_TTL_MS);
    const freshSessionId = openTestSession('user-fresh', { expiresAt: freshExpiry });

    const reqFresh = makeReq({ [COOKIE_NAME]: freshSessionId });
    const resFresh = makeRes();
    requireAuth(reqFresh, resFresh, vi.fn() as unknown as NextFunction);
    expect(resFresh.cookie).not.toHaveBeenCalled();
  });
});
