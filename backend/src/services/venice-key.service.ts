import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultPrisma } from '../lib/prisma';
import { decrypt, encrypt } from './crypto.service';

export const DEFAULT_VENICE_ENDPOINT = 'https://api.venice.ai/api/v1';

export interface VeniceKeyStatus {
  hasKey: boolean;
  lastFour: string | null;
  endpoint: string | null;
}

export class VeniceKeyInvalidError extends Error {
  constructor() {
    super('Venice API key was rejected by Venice');
    this.name = 'VeniceKeyInvalidError';
  }
}

export class VeniceKeyCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VeniceKeyCheckError';
  }
}

export const storeVeniceKeyInputSchema = z.object({
  apiKey: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, 'apiKey is required')),
  endpoint: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().url({ message: 'endpoint must be a URL' }))
    .optional(),
});

export type StoreVeniceKeyInput = z.infer<typeof storeVeniceKeyInputSchema>;

export interface VeniceKeyServiceDeps {
  client?: PrismaClient;
  fetchFn?: typeof fetch;
}

function lastFourOf(apiKey: string): string {
  return apiKey.slice(-4);
}

function resolveEndpoint(endpoint: string | null | undefined): string {
  if (endpoint && endpoint.length > 0) return endpoint;
  return DEFAULT_VENICE_ENDPOINT;
}

export function createVeniceKeyService(deps: VeniceKeyServiceDeps = {}) {
  const client = deps.client ?? defaultPrisma;

  async function validateAgainstVenice(apiKey: string, endpoint: string): Promise<void> {
    // Resolve fetch per-call so tests can stub globalThis.fetch after service
    // construction without having to pass it through deps.
    const fetchFn = deps.fetchFn ?? globalThis.fetch;
    const url = `${endpoint.replace(/\/$/, '')}/models`;
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch {
      // Intentionally drop the user-supplied endpoint and the upstream error
      // message — a crafted endpoint like https://user:pass@host could leak
      // credentials via the error message in non-production responses.
      throw new VeniceKeyCheckError('Unable to reach Venice endpoint');
    }

    if (response.status === 401 || response.status === 403) {
      throw new VeniceKeyInvalidError();
    }
    if (!response.ok) {
      throw new VeniceKeyCheckError(`Venice responded ${response.status} ${response.statusText}`);
    }
  }

  async function getStatus(userId: string): Promise<VeniceKeyStatus> {
    const row = await client.user.findUnique({
      where: { id: userId },
      select: {
        veniceApiKeyEnc: true,
        veniceApiKeyIv: true,
        veniceApiKeyAuthTag: true,
        veniceEndpoint: true,
      },
    });

    if (!row || !row.veniceApiKeyEnc || !row.veniceApiKeyIv || !row.veniceApiKeyAuthTag) {
      return { hasKey: false, lastFour: null, endpoint: null };
    }

    const plaintext = decrypt({
      ciphertext: row.veniceApiKeyEnc,
      iv: row.veniceApiKeyIv,
      authTag: row.veniceApiKeyAuthTag,
    });
    return {
      hasKey: true,
      lastFour: lastFourOf(plaintext),
      endpoint: row.veniceEndpoint ?? DEFAULT_VENICE_ENDPOINT,
    };
  }

  async function store(userId: string, rawInput: unknown): Promise<VeniceKeyStatus> {
    const input = storeVeniceKeyInputSchema.parse(rawInput);
    const endpoint = resolveEndpoint(input.endpoint);

    await validateAgainstVenice(input.apiKey, endpoint);

    const payload = encrypt(input.apiKey);

    await client.user.update({
      where: { id: userId },
      data: {
        veniceApiKeyEnc: payload.ciphertext,
        veniceApiKeyIv: payload.iv,
        veniceApiKeyAuthTag: payload.authTag,
        veniceEndpoint: input.endpoint ?? null,
      },
    });

    return {
      hasKey: true,
      lastFour: lastFourOf(input.apiKey),
      endpoint: input.endpoint ?? DEFAULT_VENICE_ENDPOINT,
    };
  }

  async function remove(userId: string): Promise<void> {
    await client.user.update({
      where: { id: userId },
      data: {
        veniceApiKeyEnc: null,
        veniceApiKeyIv: null,
        veniceApiKeyAuthTag: null,
        veniceEndpoint: null,
      },
    });
  }

  return { getStatus, store, remove, validateAgainstVenice };
}

export const veniceKeyService = createVeniceKeyService();
