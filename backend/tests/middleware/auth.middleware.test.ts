import express, { type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireAuth } from '../../src/middleware/auth.middleware';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../src/services/auth.service';
import '../setup';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.user });
  });
  return app;
}

function signAccess(payload: Record<string, unknown>, secret = process.env.JWT_SECRET!): string {
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

describe('requireAuth middleware', () => {
  it('returns 401 with a JSON error body when no Authorization header is sent', async () => {
    const res = await request(makeApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('returns 401 when the scheme is not Bearer', async () => {
    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Basic ${Buffer.from('u:p').toString('base64')}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 on a malformed token', async () => {
    const res = await request(makeApp()).get('/protected').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the token is signed with a different secret', async () => {
    const token = signAccess({ sub: 'abc', email: 'x@y.com' }, 'other-secret');
    const res = await request(makeApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 on an expired token', async () => {
    const token = jwt.sign({ sub: 'abc', email: 'x@y.com' }, process.env.JWT_SECRET!, {
      expiresIn: '-5s',
    });
    const res = await request(makeApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 on an unsigned (alg:none) token — algorithm-confusion defence', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'abc', email: 'x@y.com' })).toString(
      'base64url',
    );
    const unsigned = `${header}.${payload}.`;

    const res = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${unsigned}`);
    expect(res.status).toBe(401);
  });

  it('attaches req.user and calls next() on a valid token', async () => {
    const token = signAccess({ sub: 'user-id-1', email: 'a@b.com' });
    const res = await request(makeApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 'user-id-1', email: 'a@b.com' });
  });

  it('accepts a token whose payload has email=null (post-D15 optional email)', async () => {
    const token = signAccess({ sub: 'user-id-2', email: null });
    const res = await request(makeApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 'user-id-2', email: null });
  });
});
