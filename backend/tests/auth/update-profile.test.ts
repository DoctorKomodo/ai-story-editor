// [X3] POST /api/auth/update-profile — authenticated display-name update.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { _resetSessionStore } from '../../src/services/session-store';
import { prisma } from '../setup';

const NAME = 'Original Name';
const NEW_NAME = 'New Display Name';
const USERNAME = 'update-profile-user';
const PASSWORD = 'correct-horse-battery';

async function registerAndLogin(): Promise<{ accessToken: string; userId: string }> {
  await request(app)
    .post('/api/auth/register')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ username: USERNAME, password: PASSWORD });
  expect(login.status).toBe(200);
  return {
    accessToken: login.body.accessToken as string,
    userId: login.body.user.id as string,
  };
}

describe('[X3] POST /api/auth/update-profile', () => {
  beforeEach(async () => {
    _resetSessionStore();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    _resetSessionStore();
    await prisma.session.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it('returns 401 without a bearer token', async () => {
    const res = await request(app).post('/api/auth/update-profile').send({ name: NEW_NAME });
    expect(res.status).toBe(401);
  });

  it('happy path: 200 with updated user, DB row updated', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: NEW_NAME });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: userId,
      username: USERNAME,
      name: NEW_NAME,
    });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.name).toBe(NEW_NAME);
  });

  it('trims surrounding whitespace before storing', async () => {
    const { accessToken, userId } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '   Trimmed Name   ' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Trimmed Name');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.name).toBe('Trimmed Name');
  });

  it('rejects empty name (400 validation_error)', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('rejects whitespace-only name (400 validation_error)', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '     ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('rejects names longer than 80 chars after trim (400 validation_error)', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'a'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('does not affect other users', async () => {
    const a = await registerAndLogin();
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Second', username: 'second-user', password: PASSWORD });
    const loginB = await request(app)
      .post('/api/auth/login')
      .send({ username: 'second-user', password: PASSWORD });
    const bId = loginB.body.user.id as string;

    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ name: NEW_NAME });
    expect(res.status).toBe(200);

    const aRow = await prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
    const bRow = await prisma.user.findUniqueOrThrow({ where: { id: bId } });
    expect(aRow.name).toBe(NEW_NAME);
    expect(bRow.name).toBe('Second');
  });
});
