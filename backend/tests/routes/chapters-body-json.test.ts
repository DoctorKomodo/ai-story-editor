// [B10] Chapter save pipeline — integration tests for the bodyJson PATCH path.
//
// The PATCH /api/stories/:storyId/chapters/:chapterId handler must, whenever
// `bodyJson` is present in the request body, derive `wordCount` server-side
// via `tipTapJsonToText` and update both in a single write. Text-only PATCHes
// (title/status/orderIndex only) must NOT touch body or wordCount — this is
// the regression surface for the pipeline first shipped under [B3].

import type { Request } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { attachDekToRequest } from '../../src/services/content-crypto.service';
import { _resetSessionStore, getSession } from '../../src/services/session-store';
import { prisma } from '../setup';

const TEST_ORIGIN = 'http://localhost:3000';

interface TestSession {
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerAndLogin(
  username: string,
  password = 'b10-pw',
  name = 'B10 User',
): Promise<TestSession> {
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
  const raw = login.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = (raw ?? []).find((c) => c.startsWith('session='));
  expect(cookie).toBeDefined();
  const sessionId = decodeURIComponent(cookie!.split(';')[0].split('=')[1]);
  return { agent, sessionId };
}

function makeFakeReq(sessionId: string): Request {
  const session = getSession(sessionId);
  expect(session).not.toBeNull();
  const req = { user: { id: session!.userId, sessionId } } as unknown as Request;
  attachDekToRequest(req, session!.dek);
  return req;
}

async function resetAll(): Promise<void> {
  _resetSessionStore();
  await prisma.message.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.outlineItem.deleteMany();
  await prisma.character.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.story.deleteMany();
  await prisma.user.deleteMany();
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
    await resetAll();
  });

  afterEach(async () => {
    _resetSessionStore();
    await resetAll();
  });

  it('PATCH with bodyJson derives wordCount from the tree and returns the decrypted body', async () => {
    const { agent, sessionId } = await registerAndLogin('b10-happy');
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Save pipeline' });
    const storyId = story.id as string;

    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Untitled',
      orderIndex: 0,
    });
    const chapterId = created.id as string;

    const tree = paragraphDoc('four five six seven'); // 4 words
    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: tree });
    expect(res.status).toBe(200);
    expect(res.body.chapter.wordCount).toBe(4);
    // Body comes back as a parsed JSON tree, not a string.
    expect(typeof res.body.chapter.bodyJson).toBe('object');
    expect(res.body.chapter.bodyJson.type).toBe('doc');
    const firstParagraph = (
      res.body.chapter.bodyJson.content as Array<{ content: Array<{ text: string }> }>
    )[0];
    expect(firstParagraph.content[0].text).toBe('four five six seven');
  });

  it('PATCH with bodyJson: null clears body and sets wordCount to 0', async () => {
    const { agent, sessionId } = await registerAndLogin('b10-null');
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
    const chapterId = created.id as string;

    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: null });
    expect(res.status).toBe(200);
    expect(res.body.chapter.wordCount).toBe(0);
    expect(res.body.chapter.bodyJson).toBeNull();
  });

  it('PATCH with whitespace-only / empty-paragraph bodyJson yields wordCount 0', async () => {
    const { agent, sessionId } = await registerAndLogin('b10-empty');
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Empty' });
    const storyId = story.id as string;

    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Draft',
      orderIndex: 0,
    });
    const chapterId = created.id as string;

    const emptyTree = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
      ],
    };
    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: emptyTree });
    expect(res.status).toBe(200);
    expect(res.body.chapter.wordCount).toBe(0);
  });

  it('PATCH with bodyJson AND title in the same request updates both; wordCount reflects new body', async () => {
    const { agent, sessionId } = await registerAndLogin('b10-combo');
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

    const newTree = paragraphDoc('one two three four five six seven'); // 7 words
    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ title: 'New Title', bodyJson: newTree });
    expect(res.status).toBe(200);
    expect(res.body.chapter.title).toBe('New Title');
    expect(res.body.chapter.wordCount).toBe(7);
    const p = (res.body.chapter.bodyJson.content as Array<{ content: Array<{ text: string }> }>)[0];
    expect(p.content[0].text).toBe('one two three four five six seven');
  });

  it('text-only PATCH (title + status, no bodyJson) leaves body and wordCount untouched [B3 regression]', async () => {
    const { agent, sessionId } = await registerAndLogin('b10-text-only');
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
      .send({ title: 'Renamed', status: 'revision' });
    expect(res.status).toBe(200);
    expect(res.body.chapter.title).toBe('Renamed');
    expect(res.body.chapter.status).toBe('revision');
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
    const { agent, sessionId } = await registerAndLogin('b10-wordcount');
    const req = makeFakeReq(sessionId);
    const story = await createStoryRepo(req).create({ title: 'Counting' });
    const storyId = story.id as string;

    const created = await createChapterRepo(req).create({
      storyId,
      title: 'Ten Words',
      orderIndex: 0,
    });
    const chapterId = created.id as string;

    const tree = twoParagraphDoc(
      'The quick brown fox jumps.', // 5 words
      'Over the very lazy dog.', // 5 words
    );

    const res = await agent
      .patch(`/api/stories/${storyId}/chapters/${chapterId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ bodyJson: tree });
    expect(res.status).toBe(200);
    expect(res.body.chapter.wordCount).toBe(10);
  });
});
