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

const TEST_ORIGIN = 'http://localhost:3000';

async function registerAndLogin(
  username = 'x29-defaults-user',
  password = 'x29-defaults-password',
  name = 'X29 Defaults Tester',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/register')
    .set('Origin', TEST_ORIGIN)
    .send({ name, username, password });
  const login = await agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ username, password });
  expect(login.status).toBe(200);
  return agent;
}

async function resetAll(): Promise<void> {
  _resetSessionStore();
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
    const agent = await registerAndLogin();
    const res = await agent.get('/api/ai/default-prompts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ defaults: DEFAULT_PROMPTS });
  });

  it('every key is a non-empty string', async () => {
    const agent = await registerAndLogin();
    const res = await agent.get('/api/ai/default-prompts');
    for (const key of [
      'system',
      'continue',
      'rewrite',
      'expand',
      'summarise',
      'describe',
      'scene',
    ]) {
      expect(typeof res.body.defaults[key]).toBe('string');
      expect(res.body.defaults[key].length).toBeGreaterThan(0);
    }
  });

  it('exposes the scene default prompt', async () => {
    const agent = await registerAndLogin();
    const res = await agent.get('/api/ai/default-prompts');
    expect(res.status).toBe(200);
    expect(res.body.defaults.scene).toContain('write a passage of prose');
  });
});
