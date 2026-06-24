import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionCookieName } from '../../src/lib/session-cookie';

vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return {
    ...actual,
    hash: vi.fn(actual.hash),
    verify: vi.fn(actual.verify),
  };
});

import * as argon2 from 'argon2';
import { app } from '../../src/index';
import { prisma } from '../setup';

const USERNAME = 'login-supersede';
const PASSWORD = 'correct-horse-battery';
const TEST_ORIGIN = 'http://localhost:3000';

async function registerUser(): Promise<void> {
  const res = await request(app)
    .post('/api/auth/register')
    .set('Origin', TEST_ORIGIN)
    .send({ name: 'Supersede', username: USERNAME, password: PASSWORD });
  expect(res.status).toBe(201);
}

describe('[AU10] POST /api/auth/login — username-based supersede', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.user.deleteMany();
  });

  it('accepts { username, password } and sets the session cookie', async () => {
    await registerUser();

    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: USERNAME, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(USERNAME);

    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    const cookie = (raw ?? []).find((c) => c.startsWith(`${sessionCookieName()}=`));
    expect(cookie).toBeDefined();
    expect(cookie!.toLowerCase()).toContain('httponly');
    expect(cookie!.toLowerCase()).toContain('samesite=lax');
  });

  it('lowercases the username server-side before lookup', async () => {
    await registerUser();

    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: USERNAME.toUpperCase(), password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(USERNAME);
  });

  it('session cookie is tied to the logged-in user', async () => {
    await registerUser();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: USERNAME, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(USERNAME);
    expect(typeof res.body.user.id).toBe('string');
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    const cookie = (raw ?? []).find((c) => c.startsWith(`${sessionCookieName()}=`));
    expect(cookie).toBeDefined();
  });

  it('returns identical 401 body for unknown username vs wrong password (no enumeration)', async () => {
    await registerUser();

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: USERNAME, password: 'incorrect' });
    const unknownUser = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: 'ghost-user', password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
    expect(wrongPassword.body.error.code).toBe('invalid_credentials');
    expect(wrongPassword.body.error.message).toBe('Invalid credentials');
  });

  it('runs argon2.verify against a dummy argon2id hash when the username does not exist (timing-equalisation)', async () => {
    const verifyMock = vi.mocked(argon2.verify);
    verifyMock.mockClear();

    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: 'nobody', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(verifyMock).toHaveBeenCalledTimes(1);
    const [hashArg] = verifyMock.mock.calls[0]!;
    expect(typeof hashArg).toBe('string');
    expect((hashArg as string).startsWith('$argon2id$')).toBe(true);
  });

  it('wall-clock timing for unknown-user vs wrong-password is comparable', async () => {
    await registerUser();

    // Warm up — the first bcrypt.compare pays JIT / module load overhead
    // that can skew the two measurements.
    await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: 'warmup-user', password: PASSWORD });

    const tsUnknown = process.hrtime.bigint();
    await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: 'ghost', password: PASSWORD });
    const unknownDuration = Number(process.hrtime.bigint() - tsUnknown) / 1_000_000;

    const tsWrong = process.hrtime.bigint();
    await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: USERNAME, password: 'incorrect' });
    const wrongDuration = Number(process.hrtime.bigint() - tsWrong) / 1_000_000;

    // Both branches execute one bcrypt.compare against a 12-round hash (~200ms).
    // Require the two durations to be within a generous window — we're guarding
    // against a 10x-order gap (no compare at all on the unknown branch), not
    // sub-ms noise.
    const ratio =
      Math.max(unknownDuration, wrongDuration) /
      Math.max(1, Math.min(unknownDuration, wrongDuration));
    expect(ratio).toBeLessThan(3);
  });

  it('returns 400 for malformed username (zod validation before compare)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: 'has space', password: PASSWORD });

    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', TEST_ORIGIN).send({});
    expect(res.status).toBe(400);
  });

  it('two successful logins each receive a distinct session cookie', async () => {
    await registerUser();

    const first = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: USERNAME, password: PASSWORD });
    const second = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: USERNAME, password: PASSWORD });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstCookie = (
      (first.headers['set-cookie'] as unknown as string[] | undefined) ?? []
    ).find((c) => c.startsWith(`${sessionCookieName()}=`));
    const secondCookie = (
      (second.headers['set-cookie'] as unknown as string[] | undefined) ?? []
    ).find((c) => c.startsWith(`${sessionCookieName()}=`));
    expect(firstCookie).toBeDefined();
    expect(secondCookie).toBeDefined();
    expect(firstCookie).not.toBe(secondCookie);
  });
});
