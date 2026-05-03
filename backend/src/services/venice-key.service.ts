import type { PrismaClient } from '@prisma/client';
import type OpenAI from 'openai';
import { z } from 'zod';
import { prisma as defaultPrisma } from '../lib/prisma';
import { getVeniceClient } from '../lib/venice';
import { decrypt, encrypt } from './crypto.service';

export const DEFAULT_VENICE_ENDPOINT = 'https://api.venice.ai/api/v1';

export interface VeniceKeyStatus {
  hasKey: boolean;
  lastSix: string | null;
  endpoint: string | null;
}

export interface VeniceKeyVerifyResult {
  verified: boolean;
  balanceUsd: number | null;
  diem: number | null;
  endpoint: string | null;
  lastSix: string | null;
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
  // Injection seam for tests: override getVeniceClient so tests can stub
  // the OpenAI SDK without touching globalThis.fetch at the verify layer.
  getVeniceClientFn?: (userId: string) => Promise<OpenAI>;
}

function lastSixOf(apiKey: string): string {
  return apiKey.slice(-6);
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

    if (!row?.veniceApiKeyEnc || !row.veniceApiKeyIv || !row.veniceApiKeyAuthTag) {
      return { hasKey: false, lastSix: null, endpoint: null };
    }

    const plaintext = decrypt({
      ciphertext: row.veniceApiKeyEnc,
      iv: row.veniceApiKeyIv,
      authTag: row.veniceApiKeyAuthTag,
    });
    return {
      hasKey: true,
      lastSix: lastSixOf(plaintext),
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
      lastSix: lastSixOf(input.apiKey),
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

  // [V18] Re-validates the stored key by calling Venice (GET /v1/models) and
  // reads balance headers from the response. Never modifies stored rows —
  // purely a read + probe operation.
  async function verify(userId: string): Promise<VeniceKeyVerifyResult> {
    const status = await getStatus(userId);

    if (!status.hasKey) {
      return { verified: false, balanceUsd: null, diem: null, endpoint: null, lastSix: null };
    }

    // Use the injected getter (or the default) so tests can stub the client
    // without needing to manipulate globalThis.fetch directly.
    const getClientFn = deps.getVeniceClientFn ?? getVeniceClient;
    const veniceClient = await getClientFn(userId);

    // .withResponse() gives us the raw HTTP response so we can read balance
    // headers even though the openai SDK doesn't type them. The
    // x-venice-balance-usd header is denominated in USD (matches the figure
    // shown on Venice's account dashboard) — not arbitrary "credits".
    const { response } = await veniceClient.models.list().withResponse();

    const rawUsd = response.headers.get('x-venice-balance-usd');
    const rawDiem = response.headers.get('x-venice-balance-diem');

    const usdVal = rawUsd !== null ? parseFloat(rawUsd) : null;
    const diemVal = rawDiem !== null ? parseFloat(rawDiem) : null;

    return {
      verified: true,
      balanceUsd: usdVal !== null && !Number.isNaN(usdVal) ? usdVal : null,
      diem: diemVal !== null && !Number.isNaN(diemVal) ? diemVal : null,
      endpoint: status.endpoint,
      lastSix: status.lastSix,
    };
  }

  return { getStatus, store, remove, validateAgainstVenice, verify };
}

export const veniceKeyService = createVeniceKeyService();
