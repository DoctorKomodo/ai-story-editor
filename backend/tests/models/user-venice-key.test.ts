import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../setup';

describe('User BYOK Venice-key columns', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
  });

  it('defaults all BYOK columns to null', async () => {
    const user = await prisma.user.create({
      data: { username: 'byok1', passwordHash: 'h' },
    });
    expect(user.veniceApiKeyEnc).toBeNull();
    expect(user.veniceApiKeyIv).toBeNull();
    expect(user.veniceApiKeyAuthTag).toBeNull();
    expect(user.veniceEndpoint).toBeNull();
  });

  it('persists the full ciphertext triple plus endpoint', async () => {
    // These values are the shape the AU11 crypto helper will produce: base64-
    // encoded random bytes. Storage-layer test, not a real encryption roundtrip.
    const veniceApiKeyEnc = 'Y2lwaGVydGV4dF9mYWtlX2Jhc2U2NA==';
    const veniceApiKeyIv = 'aXZfMTJfYnl0ZXM=';
    const veniceApiKeyAuthTag = 'YXV0aF90YWdfMTZf';
    const veniceEndpoint = 'https://api.venice.ai/api/v1';
    const user = await prisma.user.create({
      data: {
        username: 'byok2',
        passwordHash: 'h',
        veniceApiKeyEnc,
        veniceApiKeyIv,
        veniceApiKeyAuthTag,
        veniceEndpoint,
      },
    });
    const loaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(loaded.veniceApiKeyEnc).toBe(veniceApiKeyEnc);
    expect(loaded.veniceApiKeyIv).toBe(veniceApiKeyIv);
    expect(loaded.veniceApiKeyAuthTag).toBe(veniceApiKeyAuthTag);
    expect(loaded.veniceEndpoint).toBe(veniceEndpoint);
  });

  it('can null out all BYOK columns in a single update (DELETE flow)', async () => {
    const user = await prisma.user.create({
      data: {
        username: 'byok3',
        passwordHash: 'h',
        veniceApiKeyEnc: 'c2V0',
        veniceApiKeyIv: 'c2V0',
        veniceApiKeyAuthTag: 'c2V0',
        veniceEndpoint: 'https://example.test',
      },
    });
    const cleared = await prisma.user.update({
      where: { id: user.id },
      data: {
        veniceApiKeyEnc: null,
        veniceApiKeyIv: null,
        veniceApiKeyAuthTag: null,
        veniceEndpoint: null,
      },
    });
    expect(cleared.veniceApiKeyEnc).toBeNull();
    expect(cleared.veniceApiKeyIv).toBeNull();
    expect(cleared.veniceApiKeyAuthTag).toBeNull();
    expect(cleared.veniceEndpoint).toBeNull();
  });
});
