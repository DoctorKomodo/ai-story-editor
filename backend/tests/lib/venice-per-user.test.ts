import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import {
  createGetVeniceClient,
  DEFAULT_VENICE_BASE_URL,
  NoVeniceKeyError,
} from '../../src/lib/venice';
import { encrypt } from '../../src/services/crypto.service';

type VeniceUserRow = {
  veniceApiKeyEnc: string | null;
  veniceApiKeyIv: string | null;
  veniceApiKeyAuthTag: string | null;
  veniceEndpoint: string | null;
};

// Build a minimal Prisma-shaped stub with only `user.findUnique`. We cast to
// the full PrismaClient type via `unknown` so we don't need to implement the
// rest of the surface and don't leak `any`.
function makePrismaStub(rows: Record<string, VeniceUserRow | null>): {
  client: import('@prisma/client').PrismaClient;
  findUniqueSpy: ReturnType<typeof vi.fn>;
} {
  const findUniqueSpy = vi.fn(
    async (args: { where: { id: string }; select?: unknown }): Promise<VeniceUserRow | null> => {
      const row = rows[args.where.id];
      return row ?? null;
    },
  );
  const client = {
    user: { findUnique: findUniqueSpy },
  } as unknown as import('@prisma/client').PrismaClient;
  return { client, findUniqueSpy };
}

function storeKey(apiKey: string): {
  veniceApiKeyEnc: string;
  veniceApiKeyIv: string;
  veniceApiKeyAuthTag: string;
} {
  const payload = encrypt(apiKey);
  return {
    veniceApiKeyEnc: payload.ciphertext,
    veniceApiKeyIv: payload.iv,
    veniceApiKeyAuthTag: payload.authTag,
  };
}

describe('lib/venice — getVeniceClient (per-user) [V17]', () => {
  it('returns a fresh OpenAI instance for a user whose BYOK columns are populated; defaults to Venice base URL when veniceEndpoint is null', async () => {
    const { client } = makePrismaStub({
      'user-1': {
        ...storeKey('sk-user-1-secret-key'),
        veniceEndpoint: null,
      },
    });
    const getVeniceClient = createGetVeniceClient({ client });

    const openaiClient = await getVeniceClient('user-1');

    expect(openaiClient).toBeInstanceOf(OpenAI);
    expect(String(openaiClient.baseURL)).toContain(DEFAULT_VENICE_BASE_URL);
  });

  it('honours a stored veniceEndpoint override', async () => {
    const { client } = makePrismaStub({
      'user-2': {
        ...storeKey('sk-user-2-secret-key'),
        veniceEndpoint: 'https://venice.self-hosted.example/api/v1',
      },
    });
    const getVeniceClient = createGetVeniceClient({ client });

    const openaiClient = await getVeniceClient('user-2');

    expect(String(openaiClient.baseURL)).toContain('self-hosted.example');
  });

  it('throws NoVeniceKeyError when the user row has no ciphertext columns', async () => {
    const { client } = makePrismaStub({
      'user-3': {
        veniceApiKeyEnc: null,
        veniceApiKeyIv: null,
        veniceApiKeyAuthTag: null,
        veniceEndpoint: null,
      },
    });
    const getVeniceClient = createGetVeniceClient({ client });

    await expect(getVeniceClient('user-3')).rejects.toBeInstanceOf(NoVeniceKeyError);
    try {
      await getVeniceClient('user-3');
    } catch (err) {
      expect((err as NoVeniceKeyError).code).toBe('venice_key_required');
    }
  });

  it('throws NoVeniceKeyError when only one of the three ciphertext fields is missing', async () => {
    const stored = storeKey('sk-partial-row');
    const { client } = makePrismaStub({
      'user-3b': {
        veniceApiKeyEnc: stored.veniceApiKeyEnc,
        veniceApiKeyIv: stored.veniceApiKeyIv,
        veniceApiKeyAuthTag: null, // partial row → treat as no key
        veniceEndpoint: null,
      },
    });
    const getVeniceClient = createGetVeniceClient({ client });

    await expect(getVeniceClient('user-3b')).rejects.toBeInstanceOf(NoVeniceKeyError);
  });

  it('throws NoVeniceKeyError when the user row does not exist', async () => {
    const { client } = makePrismaStub({});
    const getVeniceClient = createGetVeniceClient({ client });

    await expect(getVeniceClient('no-such-user')).rejects.toBeInstanceOf(NoVeniceKeyError);
  });

  it('builds distinct clients with distinct apiKeys for two different users (not cached across users)', async () => {
    const { client } = makePrismaStub({
      'user-a': { ...storeKey('sk-user-a-key'), veniceEndpoint: null },
      'user-b': { ...storeKey('sk-user-b-key'), veniceEndpoint: null },
    });

    const buildClient = vi.fn(
      ({ apiKey, endpoint }: { apiKey: string; endpoint?: string | null }) => {
        return new OpenAI({
          apiKey,
          baseURL: endpoint && endpoint.length > 0 ? endpoint : DEFAULT_VENICE_BASE_URL,
        });
      },
    );

    const getVeniceClient = createGetVeniceClient({ client, buildClient });

    const clientA = await getVeniceClient('user-a');
    const clientB = await getVeniceClient('user-b');

    expect(clientA).not.toBe(clientB);
    expect(buildClient).toHaveBeenCalledTimes(2);
    // buildClient is the only place the plaintext key surfaces; assert each
    // user's key flowed through cleanly and that they're distinct.
    const keysSeen = buildClient.mock.calls.map((call) => call[0].apiKey);
    expect(keysSeen).toEqual(['sk-user-a-key', 'sk-user-b-key']);
    expect(keysSeen[0]).not.toBe(keysSeen[1]);
  });

  it('decryption failure does not leak ciphertext bytes into the thrown error', async () => {
    // Build a valid stored row, then tamper with veniceApiKeyEnc by replacing
    // it with a same-length base64 string of different bytes. decrypt() will
    // throw a GCM auth-tag error. We assert (a) it is NOT a NoVeniceKeyError
    // (a partial/null row would throw that; a tampered row is a different
    // failure mode that must not be confused with "no key set"), and (b) none
    // of the stored ciphertext/iv/authTag values appear anywhere in the
    // error's message, String() form, or a JSON-serialised shape.
    const stored = storeKey('sk-tamper-victim');
    const tamperedEnc = Buffer.from(
      Buffer.from(stored.veniceApiKeyEnc, 'base64').map((b) => b ^ 0xff),
    ).toString('base64');
    const row: VeniceUserRow = {
      veniceApiKeyEnc: tamperedEnc,
      veniceApiKeyIv: stored.veniceApiKeyIv,
      veniceApiKeyAuthTag: stored.veniceApiKeyAuthTag,
      veniceEndpoint: null,
    };
    const { client } = makePrismaStub({ 'tamper-user': row });
    const getVeniceClient = createGetVeniceClient({ client });

    let caught: unknown;
    try {
      await getVeniceClient('tamper-user');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(NoVeniceKeyError);

    const err = caught as Error;
    const haystacks = [
      err.message,
      String(err),
      JSON.stringify({ message: err.message, name: err.name }),
    ];
    // The three stubbed ciphertext-column values must not appear verbatim
    // anywhere in the error surface. We check both the tampered enc and the
    // untampered iv/authTag we handed to the stub.
    const needles = [tamperedEnc, row.veniceApiKeyIv!, row.veniceApiKeyAuthTag!];
    for (const hay of haystacks) {
      for (const needle of needles) {
        expect(hay).not.toContain(needle);
      }
    }
  });

  it('builds a fresh instance on every call for the same user (no memoisation)', async () => {
    const { client, findUniqueSpy } = makePrismaStub({
      'user-c': { ...storeKey('sk-user-c-key'), veniceEndpoint: null },
    });

    const buildClient = vi.fn(
      ({ apiKey, endpoint }: { apiKey: string; endpoint?: string | null }) => {
        return new OpenAI({
          apiKey,
          baseURL: endpoint && endpoint.length > 0 ? endpoint : DEFAULT_VENICE_BASE_URL,
        });
      },
    );

    const getVeniceClient = createGetVeniceClient({ client, buildClient });

    const first = await getVeniceClient('user-c');
    const second = await getVeniceClient('user-c');

    expect(first).not.toBe(second);
    expect(buildClient).toHaveBeenCalledTimes(2);
    // Re-reads the DB on every call (does not cache the decrypted key).
    expect(findUniqueSpy).toHaveBeenCalledTimes(2);
  });
});
