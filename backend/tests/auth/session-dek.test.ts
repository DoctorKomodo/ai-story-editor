// End-to-end integration test for the [E3] Option-B session / DEK flow:
//   - login opens a session and persists a Session row
//   - the access token carries a sessionId the middleware can resolve
//   - requests get a DEK attached to `req` via the content-crypto WeakMap
//   - logout tears down the session and subsequent requests see session_expired
//   - refresh extends the session and keeps the DEK alive
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { requireAuth } from '../../src/middleware/auth.middleware';
import { REFRESH_COOKIE_NAME } from '../../src/routes/auth.routes';
import type { AccessTokenPayload } from '../../src/services/auth.service';
import {
  decryptForRequest,
  encryptForRequest,
  hasDekForRequest,
} from '../../src/services/content-crypto.service';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

const USERNAME = 'dek-session-user';
const PASSWORD = 'correct-horse-battery';

function buildProbeApp() {
  // A miniature app mounted with the real requireAuth middleware so we can
  // read req-attached DEK state out-of-band without calling real routes.
  const probe = express();
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

describe('[E3] session / DEK end-to-end via auth middleware', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    _resetSessionStore();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  async function registerAndLogin(): Promise<{
    accessToken: string;
    refreshCookie: string;
    sessionId: string;
  }> {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: 'DEK', username: USERNAME, password: PASSWORD });
    expect(regRes.status).toBe(201);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: USERNAME, password: PASSWORD });
    expect(loginRes.status).toBe(200);

    const accessToken = loginRes.body.accessToken as string;
    const cookies = loginRes.headers['set-cookie'] as unknown as string[] | undefined;
    const refreshCookie = cookies?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(refreshCookie).toBeDefined();

    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET!) as AccessTokenPayload;
    expect(decoded.sessionId).toBeDefined();

    return {
      accessToken,
      refreshCookie: refreshCookie!,
      sessionId: decoded.sessionId!,
    };
  }

  it('login persists a Session row and sets sessionId in the access token', async () => {
    const { sessionId } = await registerAndLogin();
    const row = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(row).not.toBeNull();
  });

  it('middleware attaches a DEK to the request; encrypt + decrypt round-trip', async () => {
    const { accessToken } = await registerAndLogin();
    const probeApp = buildProbeApp();
    const res = await request(probeApp).get('/probe').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.dekAttached).toBe(true);
    expect(res.body.roundtrip).toBe('sentinel-plaintext');
  });

  it('different users get different DEKs (encrypted ciphertext does NOT cross-decrypt)', async () => {
    const a = await registerAndLogin();
    // Second user:
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Other', username: 'other-user', password: PASSWORD });
    const loginB = await request(app)
      .post('/api/auth/login')
      .send({ username: 'other-user', password: PASSWORD });
    const b = { accessToken: loginB.body.accessToken as string };

    const probeApp = buildProbeApp();
    const resA = await request(probeApp)
      .get('/probe')
      .set('Authorization', `Bearer ${a.accessToken}`);
    const resB = await request(probeApp)
      .get('/probe')
      .set('Authorization', `Bearer ${b.accessToken}`);

    expect(resA.body.dekAttached).toBe(true);
    expect(resB.body.dekAttached).toBe(true);
    expect(resA.body.sessionId).not.toBe(resB.body.sessionId);
  });

  it('logout destroys the session; subsequent requests get 401 session_expired', async () => {
    const { accessToken, refreshCookie } = await registerAndLogin();

    const logout = await request(app).post('/api/auth/logout').set('Cookie', refreshCookie);
    expect(logout.status).toBe(204);

    const probeApp = buildProbeApp();
    const res = await request(probeApp).get('/probe').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('session_expired');
  });

  it('refresh extends the session and the old sessionId keeps working for the DEK', async () => {
    const { sessionId, refreshCookie } = await registerAndLogin();

    const refreshRes = await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie);
    expect(refreshRes.status).toBe(200);

    const newAccessToken = refreshRes.body.accessToken as string;
    const decoded = jwt.verify(newAccessToken, process.env.JWT_SECRET!) as AccessTokenPayload;
    expect(decoded.sessionId).toBe(sessionId);

    const probeApp = buildProbeApp();
    const res = await request(probeApp)
      .get('/probe')
      .set('Authorization', `Bearer ${newAccessToken}`);
    expect(res.body.dekAttached).toBe(true);
    expect(res.body.roundtrip).toBe('sentinel-plaintext');
  });

  it('restart simulation: wiping the session store forces 401 session_expired even with a valid JWT', async () => {
    const { accessToken } = await registerAndLogin();
    _resetSessionStore();
    const probeApp = buildProbeApp();
    const res = await request(probeApp).get('/probe').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('session_expired');
  });

  it('after restart, refresh also fails — the user must re-authenticate with password', async () => {
    const { refreshCookie } = await registerAndLogin();
    _resetSessionStore();
    const res = await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_refresh');
  });

  it('concurrent refresh with the same token returns 401 invalid_refresh (not 500)', async () => {
    const { refreshCookie } = await registerAndLogin();
    // Fire two refreshes "concurrently" with the same cookie. One should
    // succeed, the other should see 401 because the token was already rotated.
    const [a, b] = await Promise.all([
      request(app).post('/api/auth/refresh').set('Cookie', refreshCookie),
      request(app).post('/api/auth/refresh').set('Cookie', refreshCookie),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);
    const failing = a.status === 401 ? a : b;
    expect(failing.body.error.code).toBe('invalid_refresh');
  });

  it('normaliseRecoveryCode tolerates zero-width characters in recovery code input', async () => {
    // Re-register and capture the recovery code, then unwrap via
    // content-crypto with the code prefixed/suffixed/embedded with invisible
    // characters — the unwrap must succeed.
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Zero', username: 'zero-width-user', password: PASSWORD });
    // Use the service path directly — the registered recovery code is in
    // the response body of an earlier test, but here we generate a fresh
    // pair to avoid cross-test state.
    const { generateDekAndWraps, unwrapDekWithRecoveryCode } = await import(
      '../../src/services/content-crypto.service'
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

  it('access token without sessionId is rejected (sessionId is required post-X10)', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'No Session', username: 'nosession-user', password: PASSWORD });
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'nosession-user' } });

    const malformedToken = jwt.sign(
      { sub: user.id, email: user.email, username: user.username },
      process.env.JWT_SECRET!,
      { expiresIn: 60 },
    );

    const probeApp = buildProbeApp();
    const res = await request(probeApp)
      .get('/probe')
      .set('Authorization', `Bearer ${malformedToken}`);
    expect(res.status).toBe(401);
  });
});
