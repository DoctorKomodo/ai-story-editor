// [B10] Chapter save pipeline — integration tests for the bodyJson PATCH path.
//
// [9wk.4] Body writes moved to PATCH /api/drafts/:draftId — the handler must,
// whenever `bodyJson` is present in the request body, derive `wordCount`
// server-side via `tipTapJsonToText` and update both in a single write. The
// chapter-mounted PATCH now only accepts title/orderIndex; a text-only PATCH
// there must NOT touch body or wordCount — this is the regression surface
// for the pipeline first shipped under [B3].

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { registerAndLogin } from '../helpers/auth';
import { resetDb } from '../helpers/db';

const TEST_ORIGIN = 'http://localhost:3000';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeReq(sessionId: string): Request {
  const session = getSession(sessionId);
  expect(session).not.toBeNull();
  const req = { user: { id: session!.userId, sessionId } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}

function paragraphDoc(text: string): unknown {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

function twoParagraphDoc(first: string, second: string): unknown {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: first }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: second }],
      },
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Chapter save pipeline — PATCH bodyJson [B10]', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetDb();
  });

  it('PATCH with bodyJson derives wordCount from the tree and returns the decrypted body', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'b10-happy' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Save pipeline' });
    const storyId = story.id as string;

    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Untitled',
      orderIndex: 0,
    });
    const draftId = created.activeDraftId as string;

    const tree = paragraphDoc('four five six seven'); // 4 words
    const res = await agent
      .patch(`/api/drafts/${draftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: tree });
    expect(res.status).toBe(200);
    expect(res.body.draft.wordCount).toBe(4);
    // Body comes back as a parsed JSON tree, not a string.
    expect(typeof res.body.draft.bodyJson).toBe('object');
    expect(res.body.draft.bodyJson.type).toBe('doc');
    const firstParagraph = (
      res.body.draft.bodyJson.content as Array<{ content: Array<{ text: string }> }>
    )[0];
    expect(firstParagraph.content[0].text).toBe('four five six seven');
  });

  it('PATCH with bodyJson: null clears body and sets wordCount to 0', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'b10-null' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Clearable' });
    const storyId = story.id as string;

    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Has body',
      orderIndex: 0,
      bodyJson: paragraphDoc('some stored words here please'),
      wordCount: 5,
    });
    const draftId = created.activeDraftId as string;

    const res = await agent
      .patch(`/api/drafts/${draftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: null });
    expect(res.status).toBe(200);
    expect(res.body.draft.wordCount).toBe(0);
    expect(res.body.draft.bodyJson).toBeNull();
  });

  it('PATCH with whitespace-only / empty-paragraph bodyJson yields wordCount 0', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'b10-empty' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Empty' });
    const storyId = story.id as string;

    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Draft',
      orderIndex: 0,
    });
    const draftId = created.activeDraftId as string;

    const emptyTree = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
      ],
    };
    const res = await agent
      .patch(`/api/drafts/${draftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: emptyTree });
    expect(res.status).toBe(200);
    expect(res.body.draft.wordCount).toBe(0);
  });

  it('PATCH bodyJson on the draft then title on the chapter both take effect; wordCount reflects the new body', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'b10-combo' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Combo' });
    const storyId = story.id as string;

    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Old Title',
      orderIndex: 0,
      bodyJson: paragraphDoc('just two'), // 2 words
      wordCount: 2,
    });
    const chapterId = created.id as string;
    const draftId = created.activeDraftId as string;

    const newTree = paragraphDoc('one two three four five six seven'); // 7 words
    const draftRes = await agent
      .patch(`/api/drafts/${draftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: newTree });
    expect(draftRes.status).toBe(200);
    expect(draftRes.body.draft.wordCount).toBe(7);

    const titleRes = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'New Title' });
    expect(titleRes.status).toBe(200);
    expect(titleRes.body.chapter.title).toBe('New Title');
    expect(titleRes.body.chapter.wordCount).toBe(7);
    const p = (
      titleRes.body.chapter.bodyJson.content as Array<{ content: Array<{ text: string }> }>
    )[0];
    expect(p.content[0].text).toBe('one two three four five six seven');
  });

  it('text-only PATCH (title only, no bodyJson) leaves body and wordCount untouched [B3 regression]', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'b10-text-only' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Stable Body' });
    const storyId = story.id as string;

    const originalTree = paragraphDoc('alpha beta gamma delta'); // 4 words
    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Original Title',
      orderIndex: 0,
      bodyJson: originalTree,
      wordCount: 4,
    });
    const chapterId = created.id as string;

    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.chapter.title).toBe('Renamed');
    // Body + wordCount must be UNCHANGED.
    expect(res.body.chapter.wordCount).toBe(4);
    expect(typeof res.body.chapter.bodyJson).toBe('object');
    const p = (res.body.chapter.bodyJson.content as Array<{ content: Array<{ text: string }> }>)[0];
    expect(p.content[0].text).toBe('alpha beta gamma delta');

    // Follow-up GET confirms the body was not rewritten.
    const follow = await agent.get(`/api/stories/${storyId}/chapters/${chapterId}`);
    expect(follow.status).toBe(200);
    expect(follow.body.chapter.wordCount).toBe(4);
    const fp = (
      follow.body.chapter.bodyJson.content as Array<{ content: Array<{ text: string }> }>
    )[0];
    expect(fp.content[0].text).toBe('alpha beta gamma delta');
  });

  it('PATCH with a 2-paragraph / 10-word fixture computes wordCount === 10 (regression)', async () => {
    const { agent, sessionId } = await registerAndLogin({ username: 'b10-wordcount' });
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Counting' });
    const storyId = story.id as string;

    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Ten Words',
      orderIndex: 0,
    });
    const draftId = created.activeDraftId as string;

    const tree = twoParagraphDoc(
      'The quick brown fox jumps.', // 5 words
      'Over the very lazy dog.', // 5 words
    );

    const res = await agent
      .patch(`/api/drafts/${draftId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: tree });
    expect(res.status).toBe(200);
    expect(res.body.draft.wordCount).toBe(10);
  });
});
