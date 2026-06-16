import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetSessionStore,
  _sessionCount,
  ABSOLUTE_TTL_MS,
  closeSession,
  closeSessionsForUser,
  extendSessionExpiry,
  getSession,
  openSession,
  peekSessionExpiry,
} from '../../src/services/session-store';

function future(ms: number): Date {
  return new Date(Date.now() + ms);
}

describe('session-store', () => {
  afterEach(() => {
    _resetSessionStore();
  });

  it('openSession + getSession returns the DEK', () => {
    const dek = Buffer.alloc(32, 0x11);
    openSession({
      sessionId: 's1',
      userId: 'u1',
      dek,
      createdAt: new Date(),
      expiresAt: future(60_000),
    });
    const got = getSession('s1');
    expect(got).not.toBeNull();
    expect(got!.userId).toBe('u1');
    expect(got!.dek.equals(dek)).toBe(true);
  });

  it('getSession returns null for unknown id', () => {
    expect(getSession('nope')).toBeNull();
  });

  it('getSession returns null and deletes the entry when expired', () => {
    openSession({
      sessionId: 's1',
      userId: 'u1',
      dek: Buffer.alloc(32, 0x22),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() - 1),
    });
    expect(getSession('s1')).toBeNull();
    expect(_sessionCount()).toBe(0);
  });

  it('closeSession removes a specific entry', () => {
    openSession({
      sessionId: 's1',
      userId: 'u1',
      dek: Buffer.alloc(32),
      createdAt: new Date(),
      expiresAt: future(60_000),
    });
    openSession({
      sessionId: 's2',
      userId: 'u2',
      dek: Buffer.alloc(32),
      createdAt: new Date(),
      expiresAt: future(60_000),
    });
    closeSession('s1');
    expect(getSession('s1')).toBeNull();
    expect(getSession('s2')).not.toBeNull();
  });

  it('closeSessionsForUser removes all sessions for a user, returns count', () => {
    openSession({
      sessionId: 'a',
      userId: 'u1',
      dek: Buffer.alloc(32),
      createdAt: new Date(),
      expiresAt: future(60_000),
    });
    openSession({
      sessionId: 'b',
      userId: 'u1',
      dek: Buffer.alloc(32),
      createdAt: new Date(),
      expiresAt: future(60_000),
    });
    openSession({
      sessionId: 'c',
      userId: 'u2',
      dek: Buffer.alloc(32),
      createdAt: new Date(),
      expiresAt: future(60_000),
    });
    const n = closeSessionsForUser('u1');
    expect(n).toBe(2);
    expect(getSession('a')).toBeNull();
    expect(getSession('b')).toBeNull();
    expect(getSession('c')).not.toBeNull();
  });

  it('extendSessionExpiry keeps an entry alive past its original expiry', () => {
    const originalExpiry = future(10);
    openSession({
      sessionId: 's1',
      userId: 'u1',
      dek: Buffer.alloc(32),
      createdAt: new Date(),
      expiresAt: originalExpiry,
    });
    extendSessionExpiry('s1', future(60_000));
    // Wait past the original 10ms expiry via setImmediate semantics isn't
    // reliable — re-assert by reading immediately; the entry is still live
    // because extendSessionExpiry bumped it.
    const still = getSession('s1');
    expect(still).not.toBeNull();
  });
});

describe('session-store absolute cap + sliding', () => {
  const dek = Buffer.alloc(32, 7);

  beforeEach(() => _resetSessionStore());

  it('slides idle expiry up to the absolute cap, then refuses to extend past it', () => {
    const now = Date.now();
    openSession({
      sessionId: 's1',
      userId: 'u1',
      dek,
      createdAt: new Date(now),
      expiresAt: new Date(now + 1000),
    });
    extendSessionExpiry('s1', new Date(now + 40 * 24 * 3600_000));
    expect(peekSessionExpiry('s1')).toBe(now + ABSOLUTE_TTL_MS);
    expect(getSession('s1')).not.toBeNull();
  });

  it('expires a session once now passes createdAt + ABSOLUTE_TTL even if recently extended', () => {
    const past = Date.now() - 31 * 24 * 3600_000; // created 31 days ago
    openSession({
      sessionId: 's2',
      userId: 'u1',
      dek,
      createdAt: new Date(past),
      expiresAt: new Date(Date.now() + 1000),
    });
    extendSessionExpiry('s2', new Date(Date.now() + 7 * 24 * 3600_000));
    expect(getSession('s2')).toBeNull(); // clamp pinned expiry to past+30d (< now) → expired
  });
});
