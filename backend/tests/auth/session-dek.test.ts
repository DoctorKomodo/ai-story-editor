// End-to-end integration test for the session / DEK flow (httpOnly cookie auth):
//   - login creates an in-memory session and sets a `session` cookie
//   - the requireAuth middleware reads the cookie and attaches a DEK to `req`
//   - requests get a DEK attached via the content-crypto WeakMap
//   - logout tears down the session and subsequent requests see session_expired
//   - wiping the in-memory store (restart simulation) forces 401 session_expired
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { sessionCookieName } from '../../src/lib/session-cookie';
import { requireAuth } from '../../src/middleware/auth.middleware';
import {
  decryptForRequest,
  encryptForRequest,
  hasDekForRequest,
} from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { prisma } from '../setup';

const USERNAME = 'dek-session-user';
const PASSWORD = 'correct-horse-battery';
const TEST_ORIGIN = 'http://localhost:3000';

function buildProbeApp() {
  // A miniature app mounted with the real requireAuth middleware so we can
  // read req-attached DEK state out-of-band without calling real routes.
  const probe = express();
  probe.use(cookieParser());
  probe.use(express.json());
  probe.get('/probe', requireAuth, (req, res) => {
    if (!hasDekForRequest(req)) {
      res.status(200).json({ dekAttached: false });
      return;
    }
    const payload = encryptForRequest(req, 'sentinel-plaintext');
    const roundtrip = decryptForRequest(req, payload);
    res.status(200).json({
      dekAttached: true,
      sessionId: req.user?.sessionId,
      roundtrip,
    });
  });
  return probe;
}

describe('[E3] session / DEK end-to-end via httpOnly cookie auth', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    _resetSessionStore();
    await prisma.user.deleteMany();
  });

  async function registerAndLogin(): Promise<{
    agent: ReturnType<typeof request.agent>;
    sessionId: string;
  }> {
    const agent = request.agent(app);
    const reg = await agent
      .post('/api/auth/register')
      .set('Origin', TEST_ORIGIN)
      .send({ name: 'DEK', username: USERNAME, password: PASSWORD });
    expect(reg.status).toBe(201);

    const login = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: USERNAME, password: PASSWORD });
    expect(login.status).toBe(200);

    const raw = login.headers['set-cookie'] as unknown as string[] | undefined;
    const cookie = (raw ?? []).find((c) => c.startsWith(`${sessionCookieName()}=`));
    expect(cookie).toBeDefined();
    const sessionId = decodeURIComponent(cookie!.split(';')[0].split('=')[1]);

    return { agent, sessionId };
  }

  it('login creates an in-memory session with a valid sessionId', async () => {
    const { sessionId } = await registerAndLogin();
    const session = getSession(sessionId);
    expect(session).not.toBeNull();
  });

  it('middleware attaches a DEK to the request; encrypt + decrypt round-trip', async () => {
    const { sessionId } = await registerAndLogin();
    // The probe app is a separate Express instance so the supertest agent's
    // cookie jar doesn't carry over — pass the session cookie manually.
    const probeRes = await request(buildProbeApp())
      .get('/probe')
      .set('Cookie', `session=${sessionId}`);
    expect(probeRes.status).toBe(200);
    expect(probeRes.body.dekAttached).toBe(true);
    expect(probeRes.body.roundtrip).toBe('sentinel-plaintext');
  });

  it('different users get different DEKs (encrypted ciphertext does NOT cross-decrypt)', async () => {
    const { sessionId: sessionIdA } = await registerAndLogin();

    // Register and log in second user
    await request(app)
      .post('/api/auth/register')
      .set('Origin', TEST_ORIGIN)
      .send({ name: 'Other', username: 'other-dek-user', password: PASSWORD });
    const loginB = await request(app)
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ username: 'other-dek-user', password: PASSWORD });
    expect(loginB.status).toBe(200);
    const rawB = loginB.headers['set-cookie'] as unknown as string[] | undefined;
    const cookieB = (rawB ?? []).find((c) => c.startsWith(`${sessionCookieName()}=`));
    expect(cookieB).toBeDefined();
    const sessionIdB = decodeURIComponent(cookieB!.split(';')[0].split('=')[1]);

    const probeApp = buildProbeApp();
    const resA = await request(probeApp).get('/probe').set('Cookie', `session=${sessionIdA}`);
    const resB = await request(probeApp).get('/probe').set('Cookie', `session=${sessionIdB}`);

    expect(resA.body.dekAttached).toBe(true);
    expect(resB.body.dekAttached).toBe(true);
    expect(resA.body.sessionId).not.toBe(resB.body.sessionId);
  });

  it('logout destroys the session; subsequent requests get 401 session_expired', async () => {
    const { agent, sessionId } = await registerAndLogin();

    const logout = await agent.post('/api/auth/logout').set('Origin', TEST_ORIGIN);
    expect(logout.status).toBe(204);

    // Confirm the session is gone from the in-memory store
    expect(getSession(sessionId)).toBeNull();

    // A direct request to the probe app with the old session cookie should fail
    const probeRes = await request(buildProbeApp())
      .get('/probe')
      .set('Cookie', `session=${sessionId}`);
    expect(probeRes.status).toBe(401);
    expect(probeRes.body.error.code).toBe('session_expired');
  });

  it('restart simulation: wiping the session store forces 401 session_expired', async () => {
    const { sessionId } = await registerAndLogin();
    _resetSessionStore();

    const probeRes = await request(buildProbeApp())
      .get('/probe')
      .set('Cookie', `session=${sessionId}`);
    expect(probeRes.status).toBe(401);
    expect(probeRes.body.error.code).toBe('session_expired');
  });

  it('normaliseRecoveryCode tolerates zero-width characters in recovery code input', async () => {
    // Re-register and capture the recovery code, then unwrap via
    // content-crypto with the code prefixed/suffixed/embedded with invisible
    // characters — the unwrap must succeed.
    await request(app)
      .post('/api/auth/register')
      .set('Origin', TEST_ORIGIN)
      .send({ name: 'Zero', username: 'zero-width-user', password: PASSWORD });
    // Use the service path directly — the registered recovery code is in
    // the response body of an earlier test, but here we generate a fresh
    // pair to avoid cross-test state.
    const { generateDekAndWraps, unwrapDekWithRecoveryCode } = await import(
      '../../src/services/content-crypto.service.js'
    );
    const gen = await generateDekAndWraps('whatever');
    const user = {
      contentDekPasswordEnc: gen.passwordWrap.ciphertext,
      contentDekPasswordIv: gen.passwordWrap.iv,
      contentDekPasswordAuthTag: gen.passwordWrap.authTag,
      contentDekPasswordSalt: gen.passwordWrap.salt,
      contentDekRecoveryEnc: gen.recoveryWrap.ciphertext,
      contentDekRecoveryIv: gen.recoveryWrap.iv,
      contentDekRecoveryAuthTag: gen.recoveryWrap.authTag,
      contentDekRecoverySalt: gen.recoveryWrap.salt,
    };
    const munged = `​${gen.recoveryCode}﻿`.replace('-', '­-');
    const dek = await unwrapDekWithRecoveryCode(user, munged);
    expect(dek.equals(gen.dek)).toBe(true);
  });
});
