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
