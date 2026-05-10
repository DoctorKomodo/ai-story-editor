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
//   - chat.overrides shape (X28): per-model overrides accepted, legacy flat shape rejected

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
        prose: { font: 'iowan', size: 18, lineHeight: 1.6 },
        writing: {
          spellcheck: true,
          typewriterMode: false,
          focusMode: false,
          dailyWordGoal: 0,
          smartQuotes: true,
          emDashExpansion: true,
        },
        chat: { model: null, overrides: {} },
        ai: { includeVeniceSystemPrompt: true },
        prompts: {
          system: null,
          continue: null,
          rewrite: null,
          expand: null,
          summarise: null,
          describe: null,
          scene: null,
          ask: null,
        },
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
    expect(res.body.settings.prose).toEqual({ font: 'iowan', size: 20, lineHeight: 1.6 });
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
    expect(res.body.settings.prose.font).toBe('iowan');
    expect(res.body.settings.writing.spellcheck).toBe(true);
    expect(res.body.settings.chat.overrides).toEqual({});
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

    // Now PATCH under chat (new overrides shape).
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { 'test-model': { temperature: 0.5 } } } });

    expect(res.status).toBe(200);
    // ai.includeVeniceSystemPrompt must still be false — not blown away.
    expect(res.body.settings.ai.includeVeniceSystemPrompt).toBe(false);
    expect(res.body.settings.prose.lineHeight).toBe(1.8);
    expect(res.body.settings.chat.overrides['test-model'].temperature).toBe(0.5);
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

  it('[F66] PATCH writing.smartQuotes / emDashExpansion persists', async () => {
    const token = await registerAndLogin('typo-user');

    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ writing: { smartQuotes: true, emDashExpansion: true } })
      .expect(200);

    const res = await request(app)
      .get('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.settings.writing.smartQuotes).toBe(true);
    expect(res.body.settings.writing.emDashExpansion).toBe(true);
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

  it('PATCH accepts chat.overrides temperature: 0 (boundary)', async () => {
    const token = await registerAndLogin('temp-zero-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { 'test-model': { temperature: 0 } } } });

    expect(res.status).toBe(200);
    expect(res.body.settings.chat.overrides['test-model'].temperature).toBe(0);
  });

  it('accepts chat.overrides maxTokens above the previous 32_768 ceiling (up to 1_000_000)', async () => {
    const token = await registerAndLogin('max-tokens-high-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { 'test-model': { maxTokens: 65_536 } } } });
    expect(res.status).toBe(200);
    expect(res.body.settings.chat.overrides['test-model'].maxTokens).toBe(65_536);
  });

  it('rejects chat.overrides maxTokens above the 1_000_000 sanity ceiling', async () => {
    const token = await registerAndLogin('max-tokens-tooHigh-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { 'test-model': { maxTokens: 2_000_000 } } } });
    expect(res.status).toBe(400);
  });
});

// ─── [X29] prompts slice ──────────────────────────────────────────────────────

describe('[X29] settingsJson.prompts slice', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('GET defaults: prompts.{key} = null for all keys when never written', async () => {
    const token = await registerAndLogin('prompts-defaults-user');
    const res = await request(app)
      .get('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.settings.prompts).toEqual({
      system: null,
      continue: null,
      rewrite: null,
      expand: null,
      summarise: null,
      describe: null,
      scene: null,
      ask: null,
    });
  });

  it('PATCH { prompts: { scene: "X" } } round-trips, and { scene: null } clears it', async () => {
    const token = await registerAndLogin('prompts-scene-user');
    const set = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { scene: 'Direct the scene.' } });
    expect(set.status).toBe(200);
    expect(set.body.settings.prompts.scene).toBe('Direct the scene.');

    const cleared = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { scene: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.settings.prompts.scene).toBeNull();
  });

  it('PATCH { prompts: { system: "X" } } round-trips', async () => {
    const token = await registerAndLogin('prompts-roundtrip-user');
    const patch = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { system: 'My system prompt.' } });
    expect(patch.status).toBe(200);
    expect(patch.body.settings.prompts.system).toBe('My system prompt.');

    const get = await request(app)
      .get('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(get.body.settings.prompts.system).toBe('My system prompt.');
    expect(get.body.settings.prompts.continue).toBeNull();
  });

  it('two PATCHes deep-merge: setting prompts.system then prompts.continue keeps both', async () => {
    const token = await registerAndLogin('prompts-merge-user');
    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { system: 'A' } });
    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { continue: 'B' } });

    const get = await request(app)
      .get('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(get.body.settings.prompts.system).toBe('A');
    expect(get.body.settings.prompts.continue).toBe('B');
  });

  it('PATCH { prompts: { system: null } } clears the override', async () => {
    const token = await registerAndLogin('prompts-clear-user');
    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { system: 'X' } });
    await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { system: null } });

    const get = await request(app)
      .get('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(get.body.settings.prompts.system).toBeNull();
  });

  it('rejects strings longer than 10 000 chars', async () => {
    const token = await registerAndLogin('prompts-toolong-user');
    const tooLong = 'x'.repeat(10_001);
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { system: tooLong } });
    expect(res.status).toBe(400);
  });

  it('rejects unknown keys under prompts (.strict())', async () => {
    const token = await registerAndLogin('prompts-unknown-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompts: { unknownKey: 'x' } });
    expect(res.status).toBe(400);
  });
});

// ─── [X28] chat.overrides shape ──────────────────────────────────────────────

describe('PATCH /api/users/me/settings — chat.overrides shape (X28)', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('accepts a chat.overrides patch with one model', async () => {
    const token = await registerAndLogin('x28-one-model-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { 'qwen-3-6-plus': { temperature: 0.4 } } } });
    expect(res.status).toBe(200);
    expect(res.body.settings.chat.overrides['qwen-3-6-plus']).toEqual({ temperature: 0.4 });
  });

  it('accepts partial overrides — only set fields are persisted', async () => {
    const token = await registerAndLogin('x28-partial-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { m1: { topP: 0.6 } } } });
    expect(res.status).toBe(200);
    expect(res.body.settings.chat.overrides['m1']).toEqual({ topP: 0.6 });
  });

  it('rejects unknown fields inside an override', async () => {
    const token = await registerAndLogin('x28-unknown-field-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { m1: { topK: 40 } } } });
    expect(res.status).toBe(400);
  });

  it('rejects the legacy flat chat.temperature field', async () => {
    const token = await registerAndLogin('x28-legacy-flat-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { temperature: 0.5 } });
    expect(res.status).toBe(400);
  });

  it('rejects out-of-range override values', async () => {
    const token = await registerAndLogin('x28-oor-user');
    const res = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { m1: { temperature: 5 } } } });
    expect(res.status).toBe(400);
  });

  // Reset to defaults: sending an empty entry for a model clears its overrides.
  // Per-model entries are atomic — they replace, not deep-merge — so `{}` means
  // "no overrides for this model" and the prior fields drop. Without this, the
  // SettingsModelsTab Reset button is a no-op and the sliders snap back to the
  // override values right after flashing to defaults.
  it('treats chat.overrides[modelId] as atomic — empty entry clears overrides', async () => {
    const token = await registerAndLogin('x28-reset-user');

    // First set an override.
    const set = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { m1: { temperature: 1.5, topP: 0.8 } } } });
    expect(set.status).toBe(200);
    expect(set.body.settings.chat.overrides.m1).toEqual({ temperature: 1.5, topP: 0.8 });

    // Then reset that model with an empty entry.
    const reset = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { m1: {} } } });
    expect(reset.status).toBe(200);
    expect(reset.body.settings.chat.overrides.m1).toEqual({});
  });

  it('reset of one model does not affect overrides for other models', async () => {
    const token = await registerAndLogin('x28-reset-isolated-user');

    const seed = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        chat: {
          overrides: { m1: { temperature: 1.2 }, m2: { topP: 0.3 } },
        },
      });
    expect(seed.status).toBe(200);

    const reset = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { m1: {} } } });
    expect(reset.status).toBe(200);
    expect(reset.body.settings.chat.overrides.m1).toEqual({});
    expect(reset.body.settings.chat.overrides.m2).toEqual({ topP: 0.3 });
  });

  // Distinct from the atomic-entry rule above: when a per-model entry IS
  // populated, fields the patch omits should not leak from the prior entry.
  // Sending { m1: { temperature: 0.4 } } after { m1: { temperature: 1.5, topP: 0.8 } }
  // must yield { temperature: 0.4 } only — no stale topP.
  it('replaces a populated per-model entry wholesale (no field leakage)', async () => {
    const token = await registerAndLogin('x28-replace-user');

    const set = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { m1: { temperature: 1.5, topP: 0.8 } } } });
    expect(set.status).toBe(200);

    const replace = await request(app)
      .patch('/api/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ chat: { overrides: { m1: { temperature: 0.4 } } } });
    expect(replace.status).toBe(200);
    expect(replace.body.settings.chat.overrides.m1).toEqual({ temperature: 0.4 });
  });
});
