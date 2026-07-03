// [X3] POST /api/auth/update-profile — authenticated display-name update.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { registerAndLogin } from '../helpers/auth';
import { resetUsers } from '../helpers/db';
import { prisma } from '../setup';

const NAME = 'Original Name';
const NEW_NAME = 'New Display Name';
const USERNAME = 'update-profile-user';
const PASSWORD = 'correct-horse-battery';
const TEST_ORIGIN = 'http://localhost:3000';

describe('[X3] POST /api/auth/update-profile', () => {
  beforeEach(async () => {
    await resetUsers();
  });

  afterEach(async () => {
    await resetUsers();
  });

  it('returns 401 without a session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/update-profile')
      .set('Origin', TEST_ORIGIN)
      .send({ name: NEW_NAME });
    expect(res.status).toBe(401);
  });

  it('happy path: 200 with updated user, DB row updated', async () => {
    const { agent, userId } = await registerAndLogin({
      username: USERNAME,
      password: PASSWORD,
      name: NAME,
    });
    const res = await agent
      .post('/api/auth/update-profile')
      .set('Origin', TEST_ORIGIN)
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
    const { agent, userId } = await registerAndLogin({
      username: USERNAME,
      password: PASSWORD,
      name: NAME,
    });
    const res = await agent
      .post('/api/auth/update-profile')
      .set('Origin', TEST_ORIGIN)
      .send({ name: '   Trimmed Name   ' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Trimmed Name');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.name).toBe('Trimmed Name');
  });

  it('rejects empty name (400 validation_error)', async () => {
    const { agent } = await registerAndLogin({
      username: USERNAME,
      password: PASSWORD,
      name: NAME,
    });
    const res = await agent
      .post('/api/auth/update-profile')
      .set('Origin', TEST_ORIGIN)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('rejects whitespace-only name (400 validation_error)', async () => {
    const { agent } = await registerAndLogin({
      username: USERNAME,
      password: PASSWORD,
      name: NAME,
    });
    const res = await agent
      .post('/api/auth/update-profile')
      .set('Origin', TEST_ORIGIN)
      .send({ name: '     ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('rejects names longer than 80 chars after trim (400 validation_error)', async () => {
    const { agent } = await registerAndLogin({
      username: USERNAME,
      password: PASSWORD,
      name: NAME,
    });
    const res = await agent
      .post('/api/auth/update-profile')
      .set('Origin', TEST_ORIGIN)
      .send({ name: 'a'.repeat(81) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('does not affect other users', async () => {
    const a = await registerAndLogin({ username: USERNAME, password: PASSWORD, name: NAME });
    const b = await registerAndLogin({
      username: 'second-user',
      password: PASSWORD,
      name: 'Second',
    });

    const res = await a.agent
      .post('/api/auth/update-profile')
      .set('Origin', TEST_ORIGIN)
      .send({ name: NEW_NAME });
    expect(res.status).toBe(200);

    const aRow = await prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
    const bRow = await prisma.user.findUniqueOrThrow({ where: { id: b.userId } });
    expect(aRow.name).toBe(NEW_NAME);
    expect(bRow.name).toBe('Second');
  });
});
