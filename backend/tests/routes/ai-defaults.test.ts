// backend/tests/routes/ai-defaults.test.ts
//
// [X29] GET /api/ai/default-prompts — exposes the constant DEFAULT_PROMPTS
// so the Settings → Prompts tab renders the same strings the backend will
// fall back to. Auth-required.
//
// Uses the same pattern as the other route tests: the real `app` from
// src/index.ts (which already mounts the new router) plus the real
// auth/register flow to mint an access token.

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { DEFAULT_PROMPTS } from '../../src/services/prompt.service';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

async function registerAndLogin(
  username = 'x29-defaults-user',
  password = 'x29-defaults-password',
  name = 'X29 Defaults Tester',
): Promise<string> {
  await request(app).post('/api/auth/register').send({ name, username, password });
  const login = await request(app).post('/api/auth/login').send({ username, password });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

async function resetAll(): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

describe('[X29] GET /api/ai/default-prompts', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('401 without auth', async () => {
    const res = await request(app).get('/api/ai/default-prompts');
    expect(res.status).toBe(401);
  });

  it('200 with auth — returns { defaults }', async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .get('/api/ai/default-prompts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ defaults: DEFAULT_PROMPTS });
  });

  it('every key is a non-empty string', async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .get('/api/ai/default-prompts')
      .set('Authorization', `Bearer ${token}`);
    for (const key of ['system', 'continue', 'rewrite', 'expand', 'summarise', 'describe']) {
      expect(typeof res.body.defaults[key]).toBe('string');
      expect(res.body.defaults[key].length).toBeGreaterThan(0);
    }
  });
});
