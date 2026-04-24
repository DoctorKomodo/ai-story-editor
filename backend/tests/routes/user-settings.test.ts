// [B11] Integration tests for GET /api/users/me/settings and PATCH /api/users/me/settings.
//
// Covers:
//   - 401 on GET / PATCH without Bearer
//   - GET returns full defaults for a new user
//   - PATCH with partial settings stores + returns merged result
//   - PATCH theme: 'dark' then GET returns dark + every other default
//   - PATCH preserves nested keys across subsequent unrelated PATCHes (deep merge)
//   - PATCH 400 on unknown top-level key
//   - PATCH 400 on unknown nested key
//   - PATCH 400 on out-of-range values
//   - GET response shape contains only { settings } — no passwordHash / ciphertext fields leaked
//   - chat.temperature: 0 is accepted (boundary)

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

async function registerAndLogin(
  username = 'settings-user',
  password = 'settings-password',
  name = 'Settings User',
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

describe('User settings routes [B11]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  // ── Auth gates ────────────────────────────────────────────────────────────

  it('GET /api/users/me/settings returns 401 without Bearer', async () => {
    const res = await request(app).get('/api/users/me/settings');
    expect(res.status).toBe(401);
  });

  it('PATCH /api/users/me/settings returns 401 without Bearer', async () => {
    const res = await request(app).patch('/api/users/me/settings').send({ theme: 'dark' });
    expect(res.status).toBe(401);
  });

  // ── GET defaults ──────────────────────────────────────────────────────────

  it('GET returns full defaults for a new user', async () => {
    const token = await registerAndLogin('defaults-user');
    const res = await request(app)
      .get('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      settings: {
        theme: 'paper',
        prose: { font: 'Lora', size: 18, lineHeight: 1.6 },
        writing: { spellcheck: true, typewriterMode: false, focusMode: false, dailyWordGoal: 0 },
        chat: { model: null, temperature: 0.8, topP: 1, maxTokens: 2048 },
        ai: { includeVeniceSystemPrompt: true },
      },
    });
  });

  // ── PATCH partial + merge ─────────────────────────────────────────────────

  it('PATCH with a partial payload stores and returns the merged result', async () => {
    const token = await registerAndLogin('partial-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prose: { size: 20 } });

    expect(res.status).toBe(200);
    // The stored prose.size overrides the default; other prose keys stay defaulted.
    expect(res.body.settings.prose).toEqual({ font: 'Lora', size: 20, lineHeight: 1.6 });
    expect(res.body.settings.theme).toBe('paper');
    expect(res.body.settings.ai.includeVeniceSystemPrompt).toBe(true);
  });

  it("PATCH theme: 'dark' then GET returns dark + defaults for everything else", async () => {
    const token = await registerAndLogin('dark-user');

    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'dark' });

    const res = await request(app)
      .get('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.settings.theme).toBe('dark');
    expect(res.body.settings.prose.font).toBe('Lora');
    expect(res.body.settings.writing.spellcheck).toBe(true);
    expect(res.body.settings.chat.temperature).toBe(0.8);
    expect(res.body.settings.ai.includeVeniceSystemPrompt).toBe(true);
  });

  it('PATCH preserves ai.includeVeniceSystemPrompt across subsequent unrelated PATCHes (deep merge)', async () => {
    const token = await registerAndLogin('merge-user');

    // First set the AI flag to false.
    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ ai: { includeVeniceSystemPrompt: false } });

    // Then patch an entirely different group.
    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prose: { lineHeight: 1.8 } });

    // Now PATCH under chat.
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { temperature: 0.5 } });

    expect(res.status).toBe(200);
    // ai.includeVeniceSystemPrompt must still be false — not blown away.
    expect(res.body.settings.ai.includeVeniceSystemPrompt).toBe(false);
    expect(res.body.settings.prose.lineHeight).toBe(1.8);
    expect(res.body.settings.chat.temperature).toBe(0.5);
  });

  // ── PATCH validation ──────────────────────────────────────────────────────

  it('PATCH returns 400 on an unknown top-level key', async () => {
    const token = await registerAndLogin('unk-top-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ foo: 'bar' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('PATCH returns 400 on an unknown nested key', async () => {
    const token = await registerAndLogin('unk-nested-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prose: { weight: 700 } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('PATCH returns 400 on out-of-range prose.size', async () => {
    const token = await registerAndLogin('size-oor-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prose: { size: 50 } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('PATCH returns 400 on negative writing.dailyWordGoal', async () => {
    const token = await registerAndLogin('goal-neg-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ writing: { dailyWordGoal: -1 } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  // ── Leakage / shape ───────────────────────────────────────────────────────

  it('GET response shape is exactly { settings } with no sensitive fields leaked', async () => {
    const token = await registerAndLogin('shape-user');
    const res = await request(app)
      .get('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['settings']);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('veniceApiKeyEnc');
    expect(body).not.toContain('Ciphertext');
    expect(body).not.toContain('contentDek');
  });

  // ── Boundary ──────────────────────────────────────────────────────────────

  it('PATCH accepts chat.temperature: 0 (boundary)', async () => {
    const token = await registerAndLogin('temp-zero-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { temperature: 0 } });

    expect(res.status).toBe(200);
    expect(res.body.settings.chat.temperature).toBe(0);
  });
});
