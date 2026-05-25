import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { _resetSessionStore } from '../../src/services/session-store';
import { makeFakeReq, registerAndLogin, resetAll } from './_chat-test-helpers';

async function setup(
  username: string,
): Promise<{ agent: ReturnType<typeof request.agent>; storyId: string; chapterId: string }> {
  const accessToken = await registerAndLogin(username);
  const req = makeFakeReq(accessToken);
  const story = await createStoryRepo(req).create({ title: 'T', worldNotes: null });
  const chapter = await createChapterRepo(req).create({
    storyId: story.id as string,
    title: 'Ch',
    bodyJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Some body text.' }] }],
    },
    orderIndex: 0,
    wordCount: 3,
  });
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${accessToken}`);
  return { agent, storyId: story.id as string, chapterId: chapter.id as string };
}

describe('PUT /api/stories/:storyId/chapters/:chapterId/summary', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('persists a user-edited summary', async () => {
    const { agent, storyId, chapterId } = await setup('put-summary-happy');
    const payload = { events: 'a', stateAtEnd: 'b', openThreads: 'c' };
    const res = await agent
      .put(`/api/stories/${storyId}/chapters/${chapterId}/summary`)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual(payload);
  });

  it('rejects invalid shape (missing required fields)', async () => {
    const { agent, storyId, chapterId } = await setup('put-summary-invalid');
    const res = await agent
      .put(`/api/stories/${storyId}/chapters/${chapterId}/summary`)
      .send({ events: 'only one field' });
    expect(res.status).toBe(400);
  });

  // Ownership middleware returns 403 (not 404) — it conflates "does not exist"
  // with "does not own" to prevent id enumeration (confirmed in ownership.middleware.ts).
  it('403 for non-owner', async () => {
    const a = await setup('put-summary-owner-a');
    const b = await setup('put-summary-owner-b');
    const res = await b.agent
      .put(`/api/stories/${a.storyId}/chapters/${a.chapterId}/summary`)
      .send({ events: 'a', stateAtEnd: 'b', openThreads: 'c' });
    expect(res.status).toBe(403);
  });
});
