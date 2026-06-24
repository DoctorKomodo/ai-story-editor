import crypto from 'node:crypto';
import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VENICE_BASE_URL, NoVeniceKeyError } from '../../src/lib/venice';
import { encryptWithDek } from '../../src/services/content-crypto.service';
import { createVeniceKeyService } from '../../src/services/venice-key.service';

const DEK = crypto.randomBytes(32);

type VeniceUserRow = {
  veniceApiKeyEnc: string | null;
  veniceApiKeyIv: string | null;
  veniceApiKeyAuthTag: string | null;
  veniceEndpoint: string | null;
};

function makePrismaStub(rows: Record<string, VeniceUserRow | null>): {
  client: import('@prisma/client').PrismaClient;
  findUniqueSpy: ReturnType<typeof vi.fn>;
} {
  const findUniqueSpy = vi.fn(
    async (args: { where: { id: string }; select?: unknown }): Promise<VeniceUserRow | null> =>
      rows[args.where.id] ?? null,
  );
  const client = {
    user: { findUnique: findUniqueSpy },
  } as unknown as import('@prisma/client').PrismaClient;
  return { client, findUniqueSpy };
}

function storeKey(
  apiKey: string,
): Pick<VeniceUserRow, 'veniceApiKeyEnc' | 'veniceApiKeyIv' | 'veniceApiKeyAuthTag'> {
  const p = encryptWithDek(DEK, apiKey);
  return { veniceApiKeyEnc: p.ciphertext, veniceApiKeyIv: p.iv, veniceApiKeyAuthTag: p.authTag };
}

function makeBuildClientSpy() {
  return vi.fn(
    ({ apiKey, endpoint }: { apiKey: string; endpoint?: string | null }) =>
      new OpenAI({
        apiKey,
        baseURL: endpoint && endpoint.length > 0 ? endpoint : DEFAULT_VENICE_BASE_URL,
      }),
  );
}

describe('venice-key.service — getClient (per-user, DEK-keyed)', () => {
  it('builds a client from the DEK-decrypted key; defaults base URL when endpoint is null', async () => {
    const { client } = makePrismaStub({
      u1: { ...storeKey('sk-user-1-secret'), veniceEndpoint: null },
    });
    const svc = createVeniceKeyService({ client });
    const openai = await svc.getClient(DEK, 'u1');
    expect(openai).toBeInstanceOf(OpenAI);
    expect(String(openai.baseURL)).toContain(DEFAULT_VENICE_BASE_URL);
  });

  it('honours a stored endpoint override', async () => {
    const { client } = makePrismaStub({
      u2: {
        ...storeKey('sk-user-2-secret'),
        veniceEndpoint: 'https://venice.self-hosted.example/api/v1',
      },
    });
    const svc = createVeniceKeyService({ client });
    const openai = await svc.getClient(DEK, 'u2');
    expect(String(openai.baseURL)).toContain('self-hosted.example');
  });

  it('throws NoVeniceKeyError when ciphertext columns are absent, partial, or the row is missing', async () => {
    const partial = storeKey('sk-partial');
    const { client } = makePrismaStub({
      none: {
        veniceApiKeyEnc: null,
        veniceApiKeyIv: null,
        veniceApiKeyAuthTag: null,
        veniceEndpoint: null,
      },
      partial: { ...partial, veniceApiKeyAuthTag: null, veniceEndpoint: null },
    });
    const svc = createVeniceKeyService({ client });
    await expect(svc.getClient(DEK, 'none')).rejects.toBeInstanceOf(NoVeniceKeyError);
    await expect(svc.getClient(DEK, 'partial')).rejects.toBeInstanceOf(NoVeniceKeyError);
    await expect(svc.getClient(DEK, 'ghost')).rejects.toBeInstanceOf(NoVeniceKeyError);
  });

  it('builds distinct, non-cached clients per call and per user; the decrypted key flows through buildClient', async () => {
    const { client, findUniqueSpy } = makePrismaStub({
      ua: { ...storeKey('sk-user-a'), veniceEndpoint: null },
      ub: { ...storeKey('sk-user-b'), veniceEndpoint: null },
    });
    const buildClient = makeBuildClientSpy();
    const svc = createVeniceKeyService({ client, buildClient });
    const a1 = await svc.getClient(DEK, 'ua');
    const a2 = await svc.getClient(DEK, 'ua');
    const b1 = await svc.getClient(DEK, 'ub');
    expect(a1).not.toBe(a2);
    expect(a1).not.toBe(b1);
    expect(findUniqueSpy).toHaveBeenCalledTimes(3); // re-reads the DB every call
    expect(buildClient.mock.calls.map((c) => c[0].apiKey)).toEqual([
      'sk-user-a',
      'sk-user-a',
      'sk-user-b',
    ]);
  });

  it('fails closed on a wrong DEK and never leaks ciphertext bytes', async () => {
    const { client } = makePrismaStub({
      ut: { ...storeKey('sk-tamper-victim'), veniceEndpoint: null },
    });
    const svc = createVeniceKeyService({ client });
    const wrongDek = crypto.randomBytes(32);
    let caught: unknown;
    try {
      await svc.getClient(wrongDek, 'ut');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(NoVeniceKeyError);
    const stored = storeKey('sk-tamper-victim');
    const err = caught as Error;
    const hay = `${err.message} ${String(caught)} ${JSON.stringify({ message: err.message, name: err.name })}`;
    expect(hay).not.toContain(stored.veniceApiKeyEnc);
    expect(hay).not.toContain(stored.veniceApiKeyIv);
    expect(hay).not.toContain(stored.veniceApiKeyAuthTag);
  });
});
