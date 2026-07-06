// [9wk.4] Draft route integration tests — list/fork/blank/rename/patch-body
// (with the optimistic-concurrency 409), delete/reindex, set-active,
// summary PUT, summarise POST (Venice mocked), and cross-user 403s.
//
// These routes go live ALONGSIDE the old chapter-mounted endpoints
// (chapters.routes.ts); this file does not touch those.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { _resetSessionStore } from '../../src/services/session-store';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { registerAndLogin, TEST_ORIGIN } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import {
  jsonResponse,
  MODEL_ID,
  MODEL_LIST_BODY,
  makeFakeReq,
  storeKey,
  stubVeniceFetch,
} from './_chat-test-helpers';

function paragraphDoc(text: string): unknown {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

// Recursive scan for the ciphertext-triple key suffixes — the wire contract
// must never carry `*Ciphertext` / `*Iv` / `*AuthTag` anywhere in a response.
function assertNoCiphertextKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) assertNoCiphertextKeys(v);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      expect(k.endsWith('Ciphertext') || k.endsWith('Iv') || k.endsWith('AuthTag')).toBe(false);
      assertNoCiphertextKeys(v);
    }
  }
}

async function setupChapter(username: string, body: string | null = 'one two three four') {
  const { agent, sessionId } = await registerAndLogin({ username });
  const req = makeFakeReq(sessionId);
  const story = await createStoryRepo(req).create({ title: 'S' });
  const chapter = await createChapterRepo(req).create({
    storyId: story.id as string,
    title: 'Ch',
    bodyJson: body == null ? null : paragraphDoc(body),
    orderIndex: 0,
    wordCount: body ? body.split(/\s+/).length : 0,
  });
  return {
    agent,
    storyId: story.id as string,
    chapterId: chapter.id as string,
    activeDraftId: chapter.activeDraftId as string,
  };
}

describe('Draft routes [9wk.4]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
    veniceModelsService.resetCache();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetDb();
    veniceModelsService.resetCache();
    vi.unstubAllGlobals();
  });

  it('GET /api/chapters/:chapterId/drafts lists the mint draft as active, no ciphertext keys', async () => {
    const { agent, chapterId, activeDraftId } = await setupChapter('drafts-list');
    const res = await agent.get(`/api/chapters/${chapterId}/drafts`);
    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(1);
    expect(res.body.drafts[0].id).toBe(activeDraftId);
    expect(res.body.drafts[0].isActive).toBe(true);
    expect(res.body.drafts[0].orderIndex).toBe(0);
    assertNoCiphertextKeys(res.body);
  });

  it('POST { mode: fork } copies the active draft body, recomputes wordCount, summary null, orderIndex 1', async () => {
    const { agent, chapterId } = await setupChapter('drafts-fork', 'one two three four');
    const res = await agent
      .post(`/api/chapters/${chapterId}/drafts`)
      .set('Origin', TEST_ORIGIN)
      .send({ mode: 'fork' });
    expect(res.status).toBe(201);
    expect(res.body.draft.orderIndex).toBe(1);
    expect(res.body.draft.wordCount).toBe(4);
    expect(res.body.draft.summary).toBeNull();
    expect(res.body.draft.isActive).toBe(false);
    expect(res.body.draft.bodyJson).toEqual(paragraphDoc('one two three four'));
    assertNoCiphertextKeys(res.body);
  });

  it('POST { mode: blank, label } creates an empty draft with wordCount 0 and the given label', async () => {
    const { agent, chapterId } = await setupChapter('drafts-blank');
    const res = await agent
      .post(`/api/chapters/${chapterId}/drafts`)
      .set('Origin', TEST_ORIGIN)
      .send({ mode: 'blank', label: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.draft.bodyJson).toBeNull();
    expect(res.body.draft.wordCount).toBe(0);
    expect(res.body.draft.label).toBe('x');
  });

  it('PATCH { label } renames; { label: null } clears back to positional', async () => {
    const { agent, activeDraftId } = await setupChapter('drafts-rename');

    const renamed = await agent
      .patch(`/api/drafts/${activeDraftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ label: 'renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.draft.label).toBe('renamed');

    const cleared = await agent
      .patch(`/api/drafts/${activeDraftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ label: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.draft.label).toBeNull();
  });

  it('PATCH { bodyJson } recomputes wordCount; stale expectedUpdatedAt -> 409 conflict', async () => {
    const { agent, activeDraftId } = await setupChapter('drafts-patch-body');

    const getRes = await agent.get(`/api/drafts/${activeDraftId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.draft.isActive).toBe(true);
    const staleUpdatedAt = getRes.body.draft.updatedAt as string;

    const res = await agent
      .patch(`/api/drafts/${activeDraftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: paragraphDoc('five six seven') });
    expect(res.status).toBe(200);
    expect(res.body.draft.wordCount).toBe(3);

    const conflictRes = await agent
      .patch(`/api/drafts/${activeDraftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: paragraphDoc('eight'), expectedUpdatedAt: staleUpdatedAt });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('conflict');
  });

  it('PATCH {} is a no-op: 200 with the unchanged draft, summary stays fresh', async () => {
    const { agent, chapterId, activeDraftId } = await setupChapter('drafts-patch-empty');

    const summaryRes = await agent
      .put(`/api/drafts/${activeDraftId}/summary`)
      .set('Origin', TEST_ORIGIN)
      .send({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' });
    expect(summaryRes.status).toBe(200);

    const before = await agent.get(`/api/drafts/${activeDraftId}`);
    expect(before.status).toBe(200);

    const patched = await agent
      .patch(`/api/drafts/${activeDraftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({});
    expect(patched.status).toBe(200);
    expect(patched.body.draft.updatedAt).toBe(before.body.draft.updatedAt);
    expect(patched.body.draft.label).toBe(before.body.draft.label);
    expect(patched.body.draft.bodyJson).toEqual(before.body.draft.bodyJson);

    const list = await agent.get(`/api/chapters/${chapterId}/drafts`);
    const meta = (
      list.body.drafts as Array<{ id: string; hasSummary: boolean; summaryIsStale: boolean }>
    ).find((d) => d.id === activeDraftId);
    expect(meta?.hasSummary).toBe(true);
    expect(meta?.summaryIsStale).toBe(false);
  });

  it('DELETE the active/sole draft -> 409 cannot_delete_active_draft', async () => {
    const { agent, activeDraftId } = await setupChapter('drafts-del-active');
    const res = await agent.delete(`/api/drafts/${activeDraftId}`).set('Origin', TEST_ORIGIN);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('cannot_delete_active_draft');
  });

  it('DELETE a non-active draft with 3 drafts -> 204 + survivors reindexed 0..1', async () => {
    const { agent, chapterId } = await setupChapter('drafts-del-nonactive');
    const fork1 = await agent
      .post(`/api/chapters/${chapterId}/drafts`)
      .set('Origin', TEST_ORIGIN)
      .send({ mode: 'blank' });
    const fork2 = await agent
      .post(`/api/chapters/${chapterId}/drafts`)
      .set('Origin', TEST_ORIGIN)
      .send({ mode: 'blank' });
    expect(fork1.status).toBe(201);
    expect(fork2.status).toBe(201);

    const del = await agent.delete(`/api/drafts/${fork1.body.draft.id}`).set('Origin', TEST_ORIGIN);
    expect(del.status).toBe(204);

    const list = await agent.get(`/api/chapters/${chapterId}/drafts`);
    expect(list.status).toBe(200);
    expect(list.body.drafts).toHaveLength(2);
    const orderIndexes = (list.body.drafts as Array<{ orderIndex: number }>)
      .map((d) => d.orderIndex)
      .sort((a: number, b: number) => a - b);
    expect(orderIndexes).toEqual([0, 1]);
  });

  it('PUT active-draft sets a new active draft; a draftId from another chapter is rejected', async () => {
    const { agent, chapterId } = await setupChapter('drafts-set-active');
    const fork = await agent
      .post(`/api/chapters/${chapterId}/drafts`)
      .set('Origin', TEST_ORIGIN)
      .send({ mode: 'blank' });
    expect(fork.status).toBe(201);

    const put = await agent
      .put(`/api/chapters/${chapterId}/active-draft`)
      .set('Origin', TEST_ORIGIN)
      .send({ draftId: fork.body.draft.id });
    expect(put.status).toBe(204);

    const list = await agent.get(`/api/chapters/${chapterId}/drafts`);
    const active = (list.body.drafts as Array<{ id: string; isActive: boolean }>).find(
      (d) => d.id === fork.body.draft.id,
    );
    expect(active?.isActive).toBe(true);

    const other = await setupChapter('drafts-set-active-other');
    const putOther = await agent
      .put(`/api/chapters/${chapterId}/active-draft`)
      .set('Origin', TEST_ORIGIN)
      .send({ draftId: other.activeDraftId });
    expect(putOther.status).toBe(404);
  });

  it('PUT /api/drafts/:draftId/summary stores a summary; list reflects hasSummary/summaryIsStale', async () => {
    const { agent, chapterId, activeDraftId } = await setupChapter('drafts-summary-put');
    const res = await agent
      .put(`/api/drafts/${activeDraftId}/summary`)
      .set('Origin', TEST_ORIGIN)
      .send({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' });
    expect(typeof res.body.summaryUpdatedAt).toBe('string');

    const list = await agent.get(`/api/chapters/${chapterId}/drafts`);
    const meta = (
      list.body.drafts as Array<{ id: string; hasSummary: boolean; summaryIsStale: boolean }>
    ).find((d) => d.id === activeDraftId);
    expect(meta?.hasSummary).toBe(true);
    expect(meta?.summaryIsStale).toBe(false);
  });

  it('POST /api/drafts/:draftId/summarise mocks Venice and persists the returned summary', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, activeDraftId } = await setupChapter('drafts-summarise-happy');
    await storeKey(agent, fetchSpy);
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' }),
            },
          },
        ],
      }),
    );
    const res = await agent
      .post(`/api/drafts/${activeDraftId}/summarise`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ events: 'A.', stateAtEnd: 'B.', openThreads: 'C?' });
  });

  it('POST summarise on an empty-body draft -> 400 empty_chapter', async () => {
    const fetchSpy = stubVeniceFetch();
    const { agent, activeDraftId } = await setupChapter('drafts-summarise-empty', null);
    await storeKey(agent, fetchSpy);
    const callsAfterSetup = fetchSpy.mock.calls.length;
    const res = await agent
      .post(`/api/drafts/${activeDraftId}/summarise`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('empty_chapter');
    expect(fetchSpy.mock.calls.length).toBe(callsAfterSetup);
  });

  it('cross-user 403: every draft-mounted route rejects a non-owning caller', async () => {
    const owner = await setupChapter('drafts-owner');
    const attacker = await registerAndLogin({ username: 'drafts-attacker' });

    const list = await attacker.agent.get(`/api/chapters/${owner.chapterId}/drafts`);
    expect(list.status).toBe(403);

    const post = await attacker.agent
      .post(`/api/chapters/${owner.chapterId}/drafts`)
      .set('Origin', TEST_ORIGIN)
      .send({ mode: 'blank' });
    expect(post.status).toBe(403);

    const putActive = await attacker.agent
      .put(`/api/chapters/${owner.chapterId}/active-draft`)
      .set('Origin', TEST_ORIGIN)
      .send({ draftId: owner.activeDraftId });
    expect(putActive.status).toBe(403);

    const get = await attacker.agent.get(`/api/drafts/${owner.activeDraftId}`);
    expect(get.status).toBe(403);

    const patch = await attacker.agent
      .patch(`/api/drafts/${owner.activeDraftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ label: 'nope' });
    expect(patch.status).toBe(403);

    const del = await attacker.agent
      .delete(`/api/drafts/${owner.activeDraftId}`)
      .set('Origin', TEST_ORIGIN);
    expect(del.status).toBe(403);

    const summaryPut = await attacker.agent
      .put(`/api/drafts/${owner.activeDraftId}/summary`)
      .set('Origin', TEST_ORIGIN)
      .send({ events: 'x', stateAtEnd: 'y', openThreads: 'z' });
    expect(summaryPut.status).toBe(403);

    const summarise = await attacker.agent
      .post(`/api/drafts/${owner.activeDraftId}/summarise`)
      .set('Origin', TEST_ORIGIN)
      .send({ modelId: MODEL_ID });
    expect(summarise.status).toBe(403);
  });
});
