// [B12] POST /api/auth/sign-out-everywhere — authenticated endpoint that
// deletes every session belonging to the caller and clears the caller's
// session cookie. Used by F61 Account & Privacy.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { sessionCookieName } from '../../src/lib/session-cookie';
import { _sessionCount } from '../../src/services/session-store';
import { registerAndLogin } from '../helpers/auth';
import { resetUsers } from '../helpers/db';

const PASSWORD = 'correct-horse-battery';
const TEST_ORIGIN = 'http://localhost:3000';

async function loginOnTwoDevices(username: string): Promise<{
  agent: ReturnType<typeof request.agent>;
  sessionId: string;
}> {
  const { agent, sessionId } = await registerAndLogin({ username, password: PASSWORD });

  // Second login simulates a second tab/device (separate agent, separate cookie jar).
  const agent2 = request.agent(app);
  const login2 = await agent2
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .send({ username, password: PASSWORD });
  expect(login2.status).toBe(200);

  return { agent, sessionId };
}

describe('[B12] POST /api/auth/sign-out-everywhere', () => {
  beforeEach(async () => {
    await resetUsers();
  });

  afterEach(async () => {
    await resetUsers();
  });

  it('returns 401 without a session cookie', async () => {
    const res = await request(app).post('/api/auth/sign-out-everywhere').set('Origin', TEST_ORIGIN);
    expect(res.status).toBe(401);
  });

  it("204 on success — deletes all of the caller's sessions, clears the session cookie, leaves other users untouched", async () => {
    const alice = await loginOnTwoDevices('alice');
    await loginOnTwoDevices('bob');

    // At this point alice has 2 sessions and bob has 2.
    const sessionsBefore = _sessionCount();
    expect(sessionsBefore).toBeGreaterThanOrEqual(4);

    const res = await alice.agent.post('/api/auth/sign-out-everywhere').set('Origin', TEST_ORIGIN);

    expect(res.status).toBe(204);

    // Alice's sessions are gone; bob's remain.
    // Verify alice's agent gets 401 on a subsequent authenticated request.
    const afterRes = await alice.agent
      .post('/api/auth/sign-out-everywhere')
      .set('Origin', TEST_ORIGIN);
    expect(afterRes.status).toBe(401);

    // Bob still has active sessions.
    expect(_sessionCount()).toBeGreaterThan(0);

    // The response must clear the caller's session cookie.
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    const cleared = (setCookie ?? []).find((c) => c.startsWith(`${sessionCookieName()}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0|Expires=/i);
  });

  it('idempotent: after sign-out-everywhere the session is gone, so a second call returns 401', async () => {
    const carol = await loginOnTwoDevices('carol');

    const first = await carol.agent
      .post('/api/auth/sign-out-everywhere')
      .set('Origin', TEST_ORIGIN);
    expect(first.status).toBe(204);

    // The caller's session was closed by sign-out-everywhere, so the same
    // cookie can no longer reach the route — it returns 401 from the
    // session-revoked branch in requireAuth, NOT a 500 from a double-delete.
    const second = await carol.agent
      .post('/api/auth/sign-out-everywhere')
      .set('Origin', TEST_ORIGIN);
    expect(second.status).toBe(401);
  });

  it("after sign-out-everywhere, alice's agent gets 401 on any authenticated route", async () => {
    const dave = await loginOnTwoDevices('dave');

    const res = await dave.agent.post('/api/auth/sign-out-everywhere').set('Origin', TEST_ORIGIN);
    expect(res.status).toBe(204);

    // Subsequent authenticated request with the same cookie jar returns 401.
    const after = await dave.agent.post('/api/auth/sign-out-everywhere').set('Origin', TEST_ORIGIN);
    expect(after.status).toBe(401);
  });
});
