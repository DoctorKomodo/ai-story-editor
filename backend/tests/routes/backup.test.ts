import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

const TEST_ORIGIN = 'http://localhost:3000';

async function registerAndLogin(username: string) {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/register')
    .set('Origin', TEST_ORIGIN)
    .send({ name: 'U', username, password: 'backup-route-pw' });
  const login = await agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ username, password: 'backup-route-pw' });
  expect(login.status).toBe(200);
  return agent;
}

async function resetAll() {
  _resetSessionStore();
  await prisma.message.deleteMany();
  await prisma.chat.deleteMany();
  await prisma.outlineItem.deleteMany();
  await prisma.character.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.story.deleteMany();
  await prisma.user.deleteMany();
}

describe('GET /api/users/me/export', () => {
  beforeEach(resetAll);
  afterEach(resetAll);

  it('401s without a session', async () => {
    const res = await request(app).get('/api/users/me/export');
    expect(res.status).toBe(401);
  });

  it('returns a valid, decrypted, attachment-dispositioned tree for the caller', async () => {
    const agent = await registerAndLogin('export-user');
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
  });
});

describe('POST /api/users/me/import', () => {
  beforeEach(resetAll);
  afterEach(resetAll);

  it('401s without a session', async () => {
    const res = await request(app).post('/api/users/me/import').set('Origin', TEST_ORIGIN).send({});
    expect(res.status).toBe(401);
  });

  it('replace-all: wipes existing content and recreates from the file (round-trip parity)', async () => {
    const agent = await registerAndLogin('import-user');
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
    expect({ ...secondExport, exportedAt: 0 }).toEqual({ ...firstExport, exportedAt: 0 });
  });

  it('re-sequences orderIndex/order from a gappy file', async () => {
    const agent = await registerAndLogin('seq-user');
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
    const agent = await registerAndLogin('flag-user');
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

  it('rejects an unknown formatVersion with 400', async () => {
    const agent = await registerAndLogin('badver-user');
    const res = await agent.post('/api/users/me/import').set('Origin', TEST_ORIGIN).send({
      formatVersion: 99,
      app: 'inkwell',
      exportedAt: '2026-06-24T12:00:00.000Z',
      stories: [],
    });
    expect(res.status).toBe(400);
  });
});
