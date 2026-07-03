import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import { app as defaultApp } from '../../src/index';
import { sessionCookieName } from '../../src/lib/session-cookie';

export const TEST_ORIGIN = 'http://localhost:3000';

export interface RegisterAndLoginOptions {
  /** App under test; defaults to the real exported app. */
  app?: Express;
  /** Login identifier; defaults to a fresh unique username per call. */
  username?: string;
  password?: string;
  name?: string;
}

export interface TestAuthSession {
  agent: ReturnType<typeof request.agent>;
  /** Opaque session id parsed from the login Set-Cookie header. */
  sessionId: string;
  /** Full session Set-Cookie entry from the login response (value + attributes). */
  sessionCookie: string;
  userId: string;
  /** One-time recovery code returned by registration. */
  recoveryCode: string;
  username: string;
  password: string;
}

let uniqueSuffix = 0;

/**
 * Register a fresh user through the real auth routes and log them in.
 *
 * Contract:
 * - Creates a brand-new user on every call (register asserted 201, login 200);
 *   never reuses an existing user.
 * - The default username is unique per call. Pass `username` only when the
 *   test asserts on the literal value, and never reuse one across tests
 *   within the same DB state.
 * - The returned agent carries the session cookie for subsequent requests.
 */
export async function registerAndLogin(
  options: RegisterAndLoginOptions = {},
): Promise<TestAuthSession> {
  const {
    app = defaultApp,
    username = `test-user-${(uniqueSuffix++).toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    password = 'helper-test-pw',
    name = 'Test User',
  } = options;
  const agent = request.agent(app);
  const reg = await agent
    .post('/api/auth/register')
    .set('Origin', TEST_ORIGIN)
    .send({ name, username, password });
  expect(reg.status).toBe(201);
  const recoveryCode = reg.body.recoveryCode as string;
  const login = await agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ username, password });
  expect(login.status).toBe(200);
  const raw = login.headers['set-cookie'] as unknown as string[] | undefined;
  const sessionCookie = (raw ?? []).find((c) => c.startsWith(`${sessionCookieName()}=`));
  expect(sessionCookie).toBeDefined();
  const sessionId = decodeURIComponent(sessionCookie!.split(';')[0].split('=')[1]);
  return {
    agent,
    sessionId,
    sessionCookie: sessionCookie!,
    userId: login.body.user.id as string,
    recoveryCode,
    username,
    password,
  };
}
