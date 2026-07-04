import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { registerAndLogin } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { prisma } from '../setup';

const TEST_ORIGIN = 'http://localhost:3000';

// The mid-file-failure test needs a deterministic, non-timing-based way to
// blow up exactly one story's transaction. `computeWordCount` runs inside
// `importOneStory`'s $transaction right before the chapter write — a marker
// field on a crafted bodyJson (itself `z.unknown()` on the wire, so any shape
// passes validation) lets the test trigger a real throw without touching
// prisma internals or fragile timing.
vi.mock('../../src/services/tiptap-text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/tiptap-text')>();
  return {
    ...actual,
    computeWordCount: (bodyJson: unknown): number => {
      if (
        bodyJson &&
        typeof bodyJson === 'object' &&
        (bodyJson as Record<string, unknown>).__importCrash === true
      ) {
        throw new Error('synthetic import failure');
      }
      return actual.computeWordCount(bodyJson);
    },
  };
});

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
    expect(res.body.formatVersion).toBe(2);
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

  it('additive default: creates a fresh copy of every file story and leaves the live library untouched', async () => {
    const { agent } = await registerAndLogin({ username: 'additive-user' });
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
    const file = (await agent.get('/api/users/me/export')).body;

    // Content written after the backup was taken — must survive the import.
    const sibling = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Written after backup' });

    const imp = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send({ file });
    expect(imp.status).toBe(200);
    expect(imp.body.imported.stories).toBe(1);
    expect(imp.body.imported.chapters).toBe(1);
    expect(imp.body.outcomes).toEqual([{ index: 0, action: 'created' }]);

    const after = (await agent.get('/api/users/me/export')).body;
    expect(after.stories).toHaveLength(3);
    const titles = after.stories.map((s: { title: string }) => s.title).sort();
    expect(titles).toEqual(['Original', 'Original', 'Written after backup']);
    // Both the original story and the post-backup sibling are untouched.
    expect(after.stories.some((s: { id: string }) => s.id === story.body.story.id)).toBe(true);
    expect(after.stories.some((s: { id: string }) => s.id === sibling.body.story.id)).toBe(true);
  });

  it('explicit replace: deletes and recreates exactly the matched story, leaves siblings untouched', async () => {
    const { agent } = await registerAndLogin({ username: 'replace-user' });
    const story = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Original', worldNotes: 'v1' });
    const storyId = story.body.story.id as string;
    const file = (await agent.get('/api/users/me/export')).body;

    const sibling = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Sibling' });

    // Drift since the backup was taken — replace should blow this away.
    await agent
      .patch(`/api/stories/${storyId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ worldNotes: 'v2-drifted' });

    const imp = await agent
      .post('/api/users/me/import')
      .set('Origin', TEST_ORIGIN)
      .send({ file, resolutions: { [storyId]: 'replace' } });
    expect(imp.status).toBe(200);
    expect(imp.body.imported.stories).toBe(1);
    expect(imp.body.outcomes).toEqual([{ index: 0, action: 'replaced' }]);

    const after = (await agent.get('/api/users/me/export')).body;
    expect(after.stories).toHaveLength(2);
    const recreated = after.stories.find((s: { title: string }) => s.title === 'Original');
    expect(recreated.worldNotes).toBe('v1');
    // The replaced story KEEPS its id ([story-editor-f1t]): an editor open on
    // it refetches the replaced content instead of dead-ending on a 404.
    expect(recreated.id).toBe(storyId);
    expect(after.stories.some((s: { id: string }) => s.id === sibling.body.story.id)).toBe(true);
  });

  it('failed recreate rolls back the delete: replace failure leaves the live story and its content intact', async () => {
    const { agent } = await registerAndLogin({ username: 'replace-fail-user' });
    const story = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Original', worldNotes: 'irreplaceable-lore' });
    const storyId = story.body.story.id as string;
    const file = (await agent.get('/api/users/me/export')).body;

    // Crash recreation partway through, after storyRepo.remove() has already
    // run inside the same $transaction as the create — if the delete weren't
    // rolled back with the rest of the transaction, the live story would be
    // gone even though the import reports 'failed'.
    file.stories[0].chapters = [
      {
        title: 'Ch',
        orderIndex: 0,
        bodyJson: { type: 'doc', content: [], __importCrash: true },
        summary: null,
        chats: [],
      },
    ];

    const imp = await agent
      .post('/api/users/me/import')
      .set('Origin', TEST_ORIGIN)
      .send({ file, resolutions: { [storyId]: 'replace' } });
    expect(imp.status).toBe(200);
    expect(imp.body.outcomes).toEqual([{ index: 0, action: 'failed' }]);
    expect(imp.body.imported.stories).toBe(0);

    const after = (await agent.get('/api/users/me/export')).body;
    expect(after.stories).toHaveLength(1);
    expect(after.stories[0].id).toBe(storyId);
    expect(after.stories[0].title).toBe('Original');
    expect(after.stories[0].worldNotes).toBe('irreplaceable-lore');
  });

  it('skip: does nothing for that story and records skipped', async () => {
    const { agent } = await registerAndLogin({ username: 'skip-user' });
    const storyA = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Story A' });
    const storyB = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Story B' });
    const storyAId = storyA.body.story.id as string;
    const file = (await agent.get('/api/users/me/export')).body;
    const indexA = file.stories.findIndex((s: { id: string }) => s.id === storyAId);

    const imp = await agent
      .post('/api/users/me/import')
      .set('Origin', TEST_ORIGIN)
      .send({ file, resolutions: { [storyAId]: 'skip' } });
    expect(imp.status).toBe(200);
    expect(imp.body.imported.stories).toBe(1);
    expect(imp.body.outcomes).toContainEqual({ index: indexA, action: 'skipped' });
    expect(imp.body.outcomes).toHaveLength(2);

    const after = (await agent.get('/api/users/me/export')).body;
    // Story A: only the original (no copy). Story B: original + one imported copy.
    expect(after.stories.filter((s: { title: string }) => s.title === 'Story A')).toHaveLength(1);
    expect(after.stories.filter((s: { title: string }) => s.title === 'Story B')).toHaveLength(2);
    expect(after.stories).toHaveLength(3);
    expect(storyB.body.story.id).toBeDefined();
  });

  it('legacy file (no ids) imports every story as new, live library untouched', async () => {
    const { agent } = await registerAndLogin({ username: 'legacy-user' });
    const existing = await agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Pre-existing', worldNotes: 'kept-as-is' });

    const legacyFile = {
      formatVersion: 2,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [
        {
          title: 'Legacy Story',
          chapters: [],
          characters: [],
          outlineItems: [],
        },
      ],
    };

    const imp = await agent
      .post('/api/users/me/import')
      .set('Origin', TEST_ORIGIN)
      .send({ file: legacyFile });
    expect(imp.status).toBe(200);
    expect(imp.body.imported.stories).toBe(1);
    expect(imp.body.outcomes).toEqual([{ index: 0, action: 'created' }]);

    const after = (await agent.get('/api/users/me/export')).body;
    expect(after.stories).toHaveLength(2);
    const preExisting = after.stories.find((s: { id: string }) => s.id === existing.body.story.id);
    expect(preExisting.title).toBe('Pre-existing');
    expect(preExisting.worldNotes).toBe('kept-as-is');
    expect(after.stories.some((s: { title: string }) => s.title === 'Legacy Story')).toBe(true);
  });

  it('a resolution for an id with no live match falls back to create', async () => {
    const { agent } = await registerAndLogin({ username: 'fallback-user' });
    const file = {
      formatVersion: 2,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [
        {
          id: 'does-not-exist-anywhere',
          title: 'Ghost Story',
          chapters: [],
          characters: [],
          outlineItems: [],
        },
      ],
    };

    const imp = await agent
      .post('/api/users/me/import')
      .set('Origin', TEST_ORIGIN)
      .send({ file, resolutions: { 'does-not-exist-anywhere': 'replace' } });
    expect(imp.status).toBe(200);
    expect(imp.body.imported.stories).toBe(1);
    expect(imp.body.outcomes).toEqual([{ index: 0, action: 'created' }]);

    const after = (await agent.get('/api/users/me/export')).body;
    expect(after.stories).toHaveLength(1);
    expect(after.stories[0].title).toBe('Ghost Story');
  });

  it("another user's story id in resolutions cannot delete that user's data", async () => {
    const owner = await registerAndLogin({ username: 'victim-owner' });
    const ownerStory = await owner.agent
      .post('/api/stories')
      .set('Origin', TEST_ORIGIN)
      .send({ title: "Owner's Story", worldNotes: 'owner-lore' });
    const ownerStoryId = ownerStory.body.story.id as string;

    const attacker = await registerAndLogin({ username: 'attacker-user' });
    const forgedFile = {
      formatVersion: 2,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [
        {
          id: ownerStoryId,
          title: 'Forged Story',
          chapters: [],
          characters: [],
          outlineItems: [],
        },
      ],
    };

    const imp = await attacker.agent
      .post('/api/users/me/import')
      .set('Origin', TEST_ORIGIN)
      .send({ file: forgedFile, resolutions: { [ownerStoryId]: 'replace' } });
    expect(imp.status).toBe(200);
    // Falls back to create — the owner's story could never be matched by the
    // attacker's owner-scoped delete, so nothing was replaced.
    expect(imp.body.outcomes).toEqual([{ index: 0, action: 'created' }]);
    expect(imp.body.imported.stories).toBe(1);

    const ownerAfter = (await owner.agent.get('/api/users/me/export')).body;
    expect(ownerAfter.stories).toHaveLength(1);
    expect(ownerAfter.stories[0].id).toBe(ownerStoryId);
    expect(ownerAfter.stories[0].title).toBe("Owner's Story");
    expect(ownerAfter.stories[0].worldNotes).toBe('owner-lore');

    const attackerAfter = (await attacker.agent.get('/api/users/me/export')).body;
    expect(attackerAfter.stories).toHaveLength(1);
    expect(attackerAfter.stories[0].id).not.toBe(ownerStoryId);
    expect(attackerAfter.stories[0].title).toBe('Forged Story');
  });

  it('mid-file failure: rolls back only the failing story, keeps prior commits, aborts the rest', async () => {
    const { agent } = await registerAndLogin({ username: 'midfail-user' });
    const file = {
      formatVersion: 2,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [
        { title: 'Good One', chapters: [], characters: [], outlineItems: [] },
        {
          title: 'Boom Story',
          chapters: [
            {
              title: 'Ch',
              orderIndex: 0,
              bodyJson: { type: 'doc', content: [], __importCrash: true },
              summary: null,
              chats: [],
            },
          ],
          characters: [],
          outlineItems: [],
        },
        { title: 'Never Attempted', chapters: [], characters: [], outlineItems: [] },
      ],
    };

    const imp = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send({ file });
    expect(imp.status).toBe(200);
    expect(imp.body.outcomes).toEqual([
      { index: 0, action: 'created' },
      { index: 1, action: 'failed' },
    ]);
    expect(imp.body.imported.stories).toBe(1);
    expect(imp.body.imported.chapters).toBe(0);

    const after = (await agent.get('/api/users/me/export')).body;
    expect(after.stories.map((s: { title: string }) => s.title)).toEqual(['Good One']);
  });

  it('mid-chapter failure rolls back a completed chapter+draft mint from an earlier chapter in the same story', async () => {
    // Regression proof for the [story-editor-9wk.3] claim in import.service.ts
    // (~lines 66-70): chapterRepo.create's own $transaction — which mints a
    // Chapter row + its initial Draft + the activeDraftId pointer — must join
    // the outer per-story transaction rather than escaping it. Ch1 below
    // completes chapterRepo.create (and thus its inner mint-transaction) fully
    // before Ch2's computeWordCount throws and aborts the outer transaction.
    // If the inner transaction didn't join the outer one, Ch1's Chapter+Draft
    // would survive the rollback even though the story import reports 'failed'.
    const { agent, userId } = await registerAndLogin({ username: 'midchapter-mint-user' });
    const file = {
      formatVersion: 2,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [
        {
          title: 'Two Chapters',
          chapters: [
            {
              title: 'Ch1 - completes',
              orderIndex: 0,
              bodyJson: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
              },
              summary: null,
              chats: [],
            },
            {
              title: 'Ch2 - crashes',
              orderIndex: 1,
              bodyJson: { type: 'doc', content: [], __importCrash: true },
              summary: null,
              chats: [],
            },
          ],
          characters: [],
          outlineItems: [],
        },
      ],
    };

    const imp = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send({ file });
    expect(imp.status).toBe(200);
    expect(imp.body.outcomes).toEqual([{ index: 0, action: 'failed' }]);
    expect(imp.body.imported.stories).toBe(0);
    expect(imp.body.imported.chapters).toBe(0);

    // Zero Chapter and Draft rows survive for this user — Ch1's completed
    // mint was rolled back along with the rest of the failed story.
    expect(await prisma.chapter.count({ where: { story: { userId } } })).toBe(0);
    expect(await prisma.draft.count({ where: { chapter: { story: { userId } } } })).toBe(0);
  });

  it('re-sequences orderIndex/order from a gappy file', async () => {
    const { agent } = await registerAndLogin({ username: 'seq-user' });
    const file = {
      formatVersion: 2,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [
        {
          title: 'S',
          chapters: [
            {
              title: 'B',
              orderIndex: 7,
              bodyJson: { type: 'doc', content: [] },
              summary: null,
              chats: [],
            },
            {
              title: 'A',
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
    const imp = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send({ file });
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

    await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send({ file: exp });
    const exp2 = (await agent.get('/api/users/me/export')).body;
    const imported = exp2.stories.find((s: { id: string }) => s.id !== story.body.story.id);
    expect(imported.includePreviousChaptersInPrompt).toBe(false);
  });

  it('round-trips a chapter summary and a chat with a message', async () => {
    const { agent } = await registerAndLogin({ username: 'summary-chat-user' });

    const summaryPayload = {
      events: 'The hero crosses the threshold.',
      stateAtEnd: 'Hero is alone at the gate.',
      openThreads: 'The gatekeeper left a riddle.',
    };

    const file = {
      formatVersion: 2,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [
        {
          title: 'Summary Story',
          chapters: [
            {
              title: 'Ch1',
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

    const imp = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send({ file });
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
    const res = await agent
      .post('/api/users/me/import')
      .set('Origin', TEST_ORIGIN)
      .send({
        file: {
          formatVersion: 99,
          app: 'inkwell',
          exportedAt: '2026-06-24T12:00:00.000Z',
          stories: [],
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unsupported_format_version');
  });

  it('rejects a real v1 backup with a distinct unsupported_format_version error', async () => {
    // The most common post-upgrade failure: a backup exported before the 1→2
    // format bump. It must fail with a nameable version error, not a generic
    // validation_error burying the cause under strict-schema issues (spec §4).
    const { agent } = await registerAndLogin({ username: 'v1-backup-user' });
    const res = await agent
      .post('/api/users/me/import')
      .set('Origin', TEST_ORIGIN)
      .send({
        file: {
          formatVersion: 1,
          app: 'inkwell',
          exportedAt: '2026-06-24T12:00:00.000Z',
          stories: [
            {
              title: 'Old Story',
              chapters: [
                {
                  title: 'Ch',
                  status: 'draft',
                  orderIndex: 0,
                  bodyJson: null,
                  summary: null,
                  chats: [],
                },
              ],
              characters: [],
              outlineItems: [],
            },
          ],
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unsupported_format_version');
  });

  it('rate-limiter fires 429 on the 6th import request within the window', async () => {
    // Fresh user → isolated rate-limit bucket (keyed on user id); won't
    // interfere with other import tests that use different usernames.
    const { agent } = await registerAndLogin({ username: 'ratelimit-user' });
    const minimalPayload = {
      file: {
        formatVersion: 2,
        app: 'inkwell',
        exportedAt: '2026-06-24T12:00:00.000Z',
        stories: [],
      },
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
