import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index';
import { veniceModelsService } from '../../src/services/venice.models.service';
import { prisma } from '../setup';

const NAME = 'AI Models User';
const USERNAME = 'ai-models-user';
const PASSWORD = 'ai-models-password';
const VALID_KEY = 'sk-venice-ai-models-test-key-LAST';

async function registerAndLogin(): Promise<string> {
  await request(app)
    .post('/api/auth/register')
    .send({ name: NAME, username: USERNAME, password: PASSWORD });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ username: USERNAME, password: PASSWORD });
  expect(login.status).toBe(200);
  return login.body.accessToken as string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'err',
    headers: { 'content-type': 'application/json' },
  });
}

const MODEL_LIST_BODY = {
  object: 'list',
  data: [
    {
      id: 'llama-3.3-70b',
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Llama 3.3 70B',
        availableContextTokens: 65536,
        capabilities: { supportsReasoning: false, supportsVision: false },
      },
    },
    {
      id: 'qwen-qwq-32b',
      object: 'model',
      type: 'text',
      model_spec: {
        name: 'Qwen QwQ 32B',
        availableContextTokens: 32768,
        capabilities: { supportsReasoning: true, supportsVision: false },
      },
    },
    {
      id: 'flux-schnell',
      object: 'model',
      type: 'image',
    },
  ],
};

describe('GET /api/ai/models [V1]', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    veniceModelsService.resetCache();

    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  async function storeKey(accessToken: string): Promise<void> {
    // PUT /venice-key hits Venice once to validate before storing. Mock that
    // validation call with a 200.
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    const res = await request(app)
      .put('/api/users/me/venice-key')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ apiKey: VALID_KEY });
    expect(res.status).toBe(200);
  }

  it('returns 401 without a Bearer token', async () => {
    const res = await request(app).get('/api/ai/models');
    expect(res.status).toBe(401);
  });

  it('returns 409 venice_key_required when the user has no stored key', async () => {
    const accessToken = await registerAndLogin();
    const res = await request(app)
      .get('/api/ai/models')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('venice_key_required');
    // Nothing hit Venice for models.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the filtered, mapped model list when the user has a key', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));

    const res = await request(app)
      .get('/api/ai/models')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      models: [
        {
          id: 'llama-3.3-70b',
          name: 'Llama 3.3 70B',
          contextLength: 65536,
          supportsReasoning: false,
          supportsVision: false,
          supportsWebSearch: false,
        },
        {
          id: 'qwen-qwq-32b',
          name: 'Qwen QwQ 32B',
          contextLength: 32768,
          supportsReasoning: true,
          supportsVision: false,
          supportsWebSearch: false,
        },
      ],
    });

    // The /models fetch went to the default Venice endpoint with the stored
    // Bearer key (decrypted from the BYOK columns).
    const modelsCall = fetchSpy.mock.calls.find(
      ([url]) => String(url).endsWith('/models') && !String(url).includes('venice-key'),
    );
    expect(modelsCall).toBeTruthy();
    const [url, init] = modelsCall!;
    expect(String(url)).toContain('/models');
    // openai SDK sets the bearer header via init.headers
    const auth =
      (init?.headers as Record<string, string> | undefined)?.Authorization ??
      (init?.headers as Record<string, string> | undefined)?.authorization;
    expect(auth).toBe(`Bearer ${VALID_KEY}`);
  });

  it('caches results in-memory: a second call within the TTL does not re-hit Venice', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken);

    // First call hits Venice exactly once for /models.
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    const first = await request(app)
      .get('/api/ai/models')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(first.status).toBe(200);

    const modelsCallsAfterFirst = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith('/models'),
    ).length;

    // Second call within the TTL must not trigger another /models fetch.
    const second = await request(app)
      .get('/api/ai/models')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const modelsCallsAfterSecond = fetchSpy.mock.calls.filter(([url]) =>
      String(url).endsWith('/models'),
    ).length;
    expect(modelsCallsAfterSecond).toBe(modelsCallsAfterFirst);
  });

  it('never exposes the plaintext Venice API key in the response body or headers', async () => {
    const accessToken = await registerAndLogin();
    await storeKey(accessToken);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, MODEL_LIST_BODY));
    const res = await request(app)
      .get('/api/ai/models')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(VALID_KEY);
    expect(JSON.stringify(res.headers)).not.toContain(VALID_KEY);
  });
});
