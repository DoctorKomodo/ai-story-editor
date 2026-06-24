import { afterEach, describe, expect, it } from 'vitest';
import { sessionCookieName, sessionCookieOptions } from '../../src/lib/session-cookie';

const orig = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = orig;
});

describe('session-cookie', () => {
  it('uses __Host- + Secure + Path=/ in production', () => {
    process.env.NODE_ENV = 'production';
    expect(sessionCookieName()).toBe('__Host-session');
    const o = sessionCookieOptions();
    expect(o).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect('domain' in o).toBe(false);
  });

  it('uses a plain name and no Secure outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(sessionCookieName()).toBe('session');
    expect(sessionCookieOptions().secure).toBe(false);
  });
});
