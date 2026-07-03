import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { registerAndLogin } from '../helpers/auth';
import { resetDb } from '../helpers/db';

const TEST_ORIGIN = 'http://localhost:3000';

describe('GET /api/users/me/export', () => {
  beforeEach(resetDb);
  afterEach(resetDb);

  it('401s without a session', async () => {
    const res = await request(app).get('/api/users/me/export');
    expect(res.status).toBe(401);
  });

  it('returns a valid, decrypted, attachment-dispositioned tree for the caller', async () => {
    const { agent } = await registerAndLogin({ username: 'export-user' });
    const story = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'My Story', worldNotes: 'secret lore' });
    await agent
      .post(`/api/stories/${story.body.story.id}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({
        title: 'Ch1',
        bodyJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }],
        },
      });

    const res = await agent.get('/api/users/me/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="inkwell-backup-export-user-\d{8}\.json"/,
    );
    expect(res.body.formatVersion).toBe(1);
    expect(res.body.stories[0].title).toBe('My Story');
    expect(res.body.stories[0].worldNotes).toBe('secret lore');
    expect(res.body.stories[0].chapters[0].bodyJson.content[0].content[0].text).toBe('hello world');
    expect(res.body.stories[0].id).toBe(story.body.story.id);
    expect(res.body.stories[0].snapshotUpdatedAt).toEqual(expect.any(String));
    expect(() => new Date(res.body.stories[0].snapshotUpdatedAt).toISOString()).not.toThrow();
  });
});

describe('POST /api/users/me/import', () => {
  beforeEach(resetDb);
  afterEach(resetDb);

  it('401s without a session', async () => {
    const res = await request(app).post('/api/users/me/import').set('Origin', TEST_ORIGIN).send({});
    expect(res.status).toBe(401);
  });

  it('replace-all: wipes existing content and recreates from the file (round-trip parity)', async () => {
    const { agent } = await registerAndLogin({ username: 'import-user' });
    const story = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Original', worldNotes: 'lore-A' });
    await agent
      .post(`/api/stories/${story.body.story.id}/chapters`)
      .set('Origin', TEST_ORIGIN)
      .send({
        title: 'Ch1',
        bodyJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alpha beta' }] }],
        },
      });
    const firstExport = (await agent.get('/api/users/me/export')).body;

    await agent.post('/api/stories').set('Origin', TEST_ORIGIN).send({ title: 'TO BE DELETED' });

    const imp = await agent
      .post('/api/users/me/import')
      .set('Origin', TEST_ORIGIN)
      .send(firstExport);
    expect(imp.status).toBe(200);
    expect(imp.body.imported.stories).toBe(1);
    expect(imp.body.imported.chapters).toBe(1);

    const secondExport = (await agent.get('/api/users/me/export')).body;
    expect(secondExport.stories.map((s: { title: string }) => s.title)).toEqual(['Original']);
    expect(secondExport.stories[0].worldNotes).toBe('lore-A');
    // Import (pre-Task-3/4 conflict detection) always recreates a fresh story
    // row, so `id` and `snapshotUpdatedAt` legitimately differ across the
    // cycle — strip them before asserting content-parity of everything else.
    const stripVolatile = (file: { exportedAt: string; stories: Record<string, unknown>[] }) => ({
      ...file,
      exportedAt: 0,
      stories: file.stories.map((s) => ({ ...s, id: undefined, snapshotUpdatedAt: undefined })),
    });
    expect(stripVolatile(secondExport)).toEqual(stripVolatile(firstExport));
  });

  it('re-sequences orderIndex/order from a gappy file', async () => {
    const { agent } = await registerAndLogin({ username: 'seq-user' });
    const file = {
      formatVersion: 1,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [
        {
          title: 'S',
          chapters: [
            {
              title: 'B',
              status: 'draft',
              orderIndex: 7,
              bodyJson: { type: 'doc', content: [] },
              summary: null,
              chats: [],
            },
            {
              title: 'A',
              status: 'draft',
              orderIndex: 2,
              bodyJson: { type: 'doc', content: [] },
              summary: null,
              chats: [],
            },
          ],
          characters: [],
          outlineItems: [],
        },
      ],
    };
    const imp = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send(file);
    expect(imp.status).toBe(200);
    const out = (await agent.get('/api/users/me/export')).body;
    expect(
      out.stories[0].chapters.map((c: { title: string; orderIndex: number }) => [
        c.title,
        c.orderIndex,
      ]),
    ).toEqual([
      ['A', 0],
      ['B', 1],
    ]);
  });

  it('round-trips includePreviousChaptersInPrompt = false', async () => {
    const { agent } = await registerAndLogin({ username: 'flag-user' });
    const story = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Flagged' });
    await agent
      .patch(`/api/stories/${story.body.story.id}`)
      .set('Origin', TEST_ORIGIN)
      .send({ includePreviousChaptersInPrompt: false });
    const exp = (await agent.get('/api/users/me/export')).body;
    expect(exp.stories[0].includePreviousChaptersInPrompt).toBe(false);

    await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send(exp);
    const exp2 = (await agent.get('/api/users/me/export')).body;
    expect(exp2.stories[0].includePreviousChaptersInPrompt).toBe(false);
  });

  it('round-trips a chapter summary and a chat with a message', async () => {
    const { agent } = await registerAndLogin({ username: 'summary-chat-user' });

    const summaryPayload = {
      events: 'The hero crosses the threshold.',
      stateAtEnd: 'Hero is alone at the gate.',
      openThreads: 'The gatekeeper left a riddle.',
    };

    const file = {
      formatVersion: 1,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [
        {
          title: 'Summary Story',
          chapters: [
            {
              title: 'Ch1',
              status: 'draft',
              orderIndex: 0,
              bodyJson: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'chapter body' }] }],
              },
              summary: summaryPayload,
              chats: [
                {
                  title: 'Ask chat',
                  kind: 'ask',
                  messages: [
                    {
                      role: 'user',
                      content: 'hello from chat',
                      attachmentJson: null,
                      citationsJson: null,
                      model: null,
                      tokens: null,
                      latencyMs: null,
                      createdAt: '2026-06-24T12:00:00.000Z',
                    },
                  ],
                },
              ],
            },
          ],
          characters: [],
          outlineItems: [],
        },
      ],
    };

    const imp = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send(file);
    expect(imp.status).toBe(200);
    expect(imp.body.imported.chats).toBe(1);
    expect(imp.body.imported.messages).toBe(1);

    const exp = (await agent.get('/api/users/me/export')).body;
    const ch = exp.stories[0].chapters[0];
    expect(ch.summary).toEqual(summaryPayload);
    expect(ch.chats).toHaveLength(1);
    expect(ch.chats[0].messages).toHaveLength(1);
    expect(ch.chats[0].messages[0].content).toBe('hello from chat');
    expect(ch.chats[0].messages[0].role).toBe('user');
  });

  it('rejects an unknown formatVersion with 400', async () => {
    const { agent } = await registerAndLogin({ username: 'badver-user' });
    const res = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send({
      formatVersion: 99,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [],
    });
    expect(res.status).toBe(400);
  });

  it('rate-limiter fires 429 on the 6th import request within the window', async () => {
    // Fresh user → isolated rate-limit bucket (keyed on user id); won't
    // interfere with other import tests that use different usernames.
    const { agent } = await registerAndLogin({ username: 'ratelimit-user' });
    const minimalPayload = {
      formatVersion: 1,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [],
    };
    // Limit is 5; the 6th request in the same 60s window must be 429.
    for (let i = 0; i < 5; i++) {
      const res = await agent
        .post('/api/users/me/import')
        .set('Origin', TEST_ORIGIN)
        .send(minimalPayload);
      expect(res.status).toBe(200);
    }
    const sixth = await agent
      .post('/api/users/me/import')
      .set('Origin', TEST_ORIGIN)
      .send(minimalPayload);
    expect(sixth.status).toBe(429);
  });
});

describe('POST /api/users/me/import/plan', () => {
  beforeEach(resetDb);
  afterEach(resetDb);

  it('401s without a session', async () => {
    const res = await request(app)
      .post('/api/users/me/import/plan')
      .set('Origin', TEST_ORIGIN)
      .send({ stories: [] });
    expect(res.status).toBe(401);
  });

  it('reports new for an id with no live match', async () => {
    const { agent } = await registerAndLogin({ username: 'plan-new-user' });
    const res = await agent
      .post('/api/users/me/import/plan')
      .set('Origin', TEST_ORIGIN)
      .send({
        stories: [{ id: 'does-not-exist-anywhere', snapshotUpdatedAt: '2026-06-24T12:00:00.000Z' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.stories).toEqual([{ id: 'does-not-exist-anywhere', status: 'new' }]);
  });

  it('reports unchanged when the snapshot matches the live subtree max, conflict once it has moved on', async () => {
    const { agent } = await registerAndLogin({ username: 'plan-buckets-user' });
    const story = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Snapshot Story' });
    const storyId = story.body.story.id as string;
    const firstExport = (await agent.get('/api/users/me/export')).body;
    const snapshotUpdatedAt = firstExport.stories[0].snapshotUpdatedAt as string;

    const unchangedRes = await agent
      .post('/api/users/me/import/plan')
      .set('Origin', TEST_ORIGIN)
      .send({ stories: [{ id: storyId, snapshotUpdatedAt }] });
    expect(unchangedRes.status).toBe(200);
    expect(unchangedRes.body.stories).toEqual([{ id: storyId, status: 'unchanged' }]);

    // Ensure a strictly later timestamp on the next write before mutating,
    // so the subtree max is unambiguously past the stale snapshot.
    await new Promise((r) => setTimeout(r, 5));
    await agent
      .patch(`/api/stories/${storyId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Snapshot Story, edited' });

    const conflictRes = await agent
      .post('/api/users/me/import/plan')
      .set('Origin', TEST_ORIGIN)
      .send({ stories: [{ id: storyId, snapshotUpdatedAt }] });
    expect(conflictRes.status).toBe(200);
    expect(conflictRes.body.stories).toEqual([{ id: storyId, status: 'conflict' }]);
  });

  it("does not leak another user's story id — reports new instead of unchanged/conflict", async () => {
    const owner = await registerAndLogin({ username: 'plan-owner-user' });
    const story = await owner.agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: "Owner's Story" });
    const storyId = story.body.story.id as string;
    const ownerExport = (await owner.agent.get('/api/users/me/export')).body;
    const snapshotUpdatedAt = ownerExport.stories[0].snapshotUpdatedAt as string;

    const intruder = await registerAndLogin({ username: 'plan-intruder-user' });
    const res = await intruder.agent
      .post('/api/users/me/import/plan')
      .set('Origin', TEST_ORIGIN)
      .send({ stories: [{ id: storyId, snapshotUpdatedAt }] });
    expect(res.status).toBe(200);
    expect(res.body.stories).toEqual([{ id: storyId, status: 'new' }]);
  });

  it('rate-limiter fires 429 on the 6th plan request within the window (shared with /import)', async () => {
    const { agent } = await registerAndLogin({ username: 'plan-ratelimit-user' });
    const payload = { stories: [] };
    for (let i = 0; i < 5; i++) {
      const res = await agent
        .post('/api/users/me/import/plan')
        .set('Origin', TEST_ORIGIN)
        .send(payload);
      expect(res.status).toBe(200);
    }
    const sixth = await agent
      .post('/api/users/me/import/plan')
      .set('Origin', TEST_ORIGIN)
      .send(payload);
    expect(sixth.status).toBe(429);
  });
});
