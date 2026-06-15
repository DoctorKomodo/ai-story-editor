# Retire `APP_ENCRYPTION_KEY` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt the BYOK Venice key under the per-user content DEK instead of the server-held `APP_ENCRYPTION_KEY`, then delete that key, `crypto.service.ts`, and the boot validator.

**Architecture:** Consolidate the two existing load+decrypt sites (`lib/venice.ts:getVeniceClient` and `venice-key.service.ts:getStatusAndKey`) into one. `venice-key.service` becomes the single owner of load/encrypt/decrypt + a new `getClient(dek, userId)`; `lib/venice.ts` shrinks to a pure OpenAI-client factory (`createVeniceClient` + `NoVeniceKeyError`). The DEK is threaded into the service and `venice.models.service.fetchModels` as an explicit `dek: Buffer`, obtained at each route via `getDekFromRequest(req)`. Existing stored ciphertext (under `APP_ENCRYPTION_KEY`) is dropped by a data migration; users re-enter their key once.

**Tech Stack:** Node + Express + TypeScript, Prisma/Postgres, `openai` SDK (Venice is OpenAI-compatible), Vitest, argon2id + AES-256-GCM (`content-crypto.service`).

**Spec:** `docs/superpowers/specs/2026-06-15-retire-app-encryption-key-design.md`

**Before you start — replace `<BD_ID>`** in every commit message below with the bd issue id (e.g. `story-editor-abc`).

---

## Invariants that hold throughout

- **Green at every commit.** `make typecheck` and the backend suite (stack up) pass after each task's commit.
- **Most integration tests change nothing.** `venice-key.test.ts`, `byok-leak.test.ts`, the `ai/`+`chat/` route suites, and `chapters.summarise`/`chapters.summary-put` register+log in for real, so a real session DEK is attached (`auth.middleware.ts:79`) and they store/read through that same DEK. Once the routes thread the DEK, store/getClient stay consistent and they pass **unchanged**. Don't rewrite them pre-emptively; run them, touch one only if it goes red.
- **Three test files DO change in Task 1 — in the same commit as the scheme flip, or Task 1's commit is red:**
  - `tests/lib/venice-per-user.test.ts` — deleted, replaced by the new `getClient` service test.
  - `tests/services/venice.models.service.test.ts` — 19 `fetchModels('user-X')` call-sites must pass a DEK first arg (else `typecheck` fails: `'user-1'` is not a `Buffer`).
  - `tests/routes/venice-account.test.ts` — spies `crypto.service.decrypt` and asserts exactly one call; must move to `content-crypto.decryptWithDek` (else the spy sees 0 calls now, and the import resolves to a deleted module in Task 2).
- **`crypto.service` (app-key) is imported by exactly three test files:** `venice-account.test.ts` (import swapped in Task 1, file survives), `tests/services/crypto.service.test.ts` (deleted in Task 2), and `venice-per-user.test.ts` (deleted in Task 1). Other `crypto.service` grep hits are substring matches on `content-crypto.service` — leave them.
- **`tests/models/user-venice-key.test.ts` needs no change** — it stores opaque base64 and round-trips through Prisma (scheme-agnostic), not an encryption assertion.

---

## Task 1: Move the Venice key under the DEK; consolidate to `getClient`; reduce `lib/venice` to a factory

This is one **atomic** commit — the at-rest scheme flip can't be half-applied (a key stored under the DEK can't be read by an app-key decrypt), so the encrypt site, all decrypt sites, and the call-sites change together.

**Files:**
- Modify: `backend/src/services/venice-key.service.ts`
- Modify: `backend/src/lib/venice.ts`
- Modify: `backend/src/services/venice.models.service.ts:126-160`
- Modify: `backend/src/routes/ai.routes.ts:53,57,82,172`
- Modify: `backend/src/routes/chat.routes.ts:306,438`
- Modify: `backend/src/routes/chapters.routes.ts:295,356`
- Create: `backend/tests/services/venice-key.getClient.test.ts`
- Delete: `backend/tests/lib/venice-per-user.test.ts`
- Modify: `backend/tests/services/venice.models.service.test.ts` (19 `fetchModels` call-sites → DEK first arg)
- Modify: `backend/tests/routes/venice-account.test.ts` (decrypt spy → `decryptWithDek`)
- Modify (comments only): `backend/tests/ai/complete.test.ts:292,294`

- [ ] **Step 1: Write the failing relocated test**

Create `backend/tests/services/venice-key.getClient.test.ts` (relocates `venice-per-user.test.ts`'s subject onto `veniceKeyService.getClient`, now DEK-keyed):

```ts
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
    async (args: { where: { id: string } }): Promise<VeniceUserRow | null> => rows[args.where.id] ?? null,
  );
  const client = { user: { findUnique: findUniqueSpy } } as unknown as import('@prisma/client').PrismaClient;
  return { client, findUniqueSpy };
}

function storeKey(apiKey: string): Pick<VeniceUserRow, 'veniceApiKeyEnc' | 'veniceApiKeyIv' | 'veniceApiKeyAuthTag'> {
  const p = encryptWithDek(DEK, apiKey);
  return { veniceApiKeyEnc: p.ciphertext, veniceApiKeyIv: p.iv, veniceApiKeyAuthTag: p.authTag };
}

function makeBuildClientSpy() {
  return vi.fn(({ apiKey, endpoint }: { apiKey: string; endpoint?: string | null }) =>
    new OpenAI({ apiKey, baseURL: endpoint && endpoint.length > 0 ? endpoint : DEFAULT_VENICE_BASE_URL }));
}

describe('venice-key.service — getClient (per-user, DEK-keyed)', () => {
  it('builds a client from the DEK-decrypted key; defaults base URL when endpoint is null', async () => {
    const { client } = makePrismaStub({ 'u1': { ...storeKey('sk-user-1-secret'), veniceEndpoint: null } });
    const svc = createVeniceKeyService({ client });
    const openai = await svc.getClient(DEK, 'u1');
    expect(openai).toBeInstanceOf(OpenAI);
    expect(String(openai.baseURL)).toContain(DEFAULT_VENICE_BASE_URL);
  });

  it('honours a stored endpoint override', async () => {
    const { client } = makePrismaStub({
      'u2': { ...storeKey('sk-user-2-secret'), veniceEndpoint: 'https://venice.self-hosted.example/api/v1' },
    });
    const svc = createVeniceKeyService({ client });
    const openai = await svc.getClient(DEK, 'u2');
    expect(String(openai.baseURL)).toContain('self-hosted.example');
  });

  it('throws NoVeniceKeyError when ciphertext columns are absent, partial, or the row is missing', async () => {
    const partial = storeKey('sk-partial');
    const { client } = makePrismaStub({
      'none': { veniceApiKeyEnc: null, veniceApiKeyIv: null, veniceApiKeyAuthTag: null, veniceEndpoint: null },
      'partial': { ...partial, veniceApiKeyAuthTag: null, veniceEndpoint: null },
    });
    const svc = createVeniceKeyService({ client });
    await expect(svc.getClient(DEK, 'none')).rejects.toBeInstanceOf(NoVeniceKeyError);
    await expect(svc.getClient(DEK, 'partial')).rejects.toBeInstanceOf(NoVeniceKeyError);
    await expect(svc.getClient(DEK, 'ghost')).rejects.toBeInstanceOf(NoVeniceKeyError);
  });

  it('builds distinct, non-cached clients per call and per user; the decrypted key flows through buildClient', async () => {
    const { client, findUniqueSpy } = makePrismaStub({
      'ua': { ...storeKey('sk-user-a'), veniceEndpoint: null },
      'ub': { ...storeKey('sk-user-b'), veniceEndpoint: null },
    });
    const buildClient = makeBuildClientSpy();
    const svc = createVeniceKeyService({ client, buildClient });
    const a1 = await svc.getClient(DEK, 'ua');
    const a2 = await svc.getClient(DEK, 'ua');
    const b1 = await svc.getClient(DEK, 'ub');
    expect(a1).not.toBe(a2);
    expect(a1).not.toBe(b1);
    expect(findUniqueSpy).toHaveBeenCalledTimes(3); // re-reads the DB every call
    expect(buildClient.mock.calls.map((c) => c[0].apiKey)).toEqual(['sk-user-a', 'sk-user-a', 'sk-user-b']);
  });

  it('fails closed on a wrong DEK and never leaks ciphertext bytes', async () => {
    const { client } = makePrismaStub({ 'ut': { ...storeKey('sk-tamper-victim'), veniceEndpoint: null } });
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
    const hay = `${(caught as Error).message} ${String(caught)}`;
    expect(hay).not.toContain(stored.veniceApiKeyEnc);
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npm -w story-editor-backend run test -- tests/services/venice-key.getClient.test.ts`
(Stack must be up — `make dev` first; the backend vitest globalSetup hits Postgres regardless of which file you target.)
Expected: FAIL — `createVeniceKeyService(...).getClient is not a function` / type error.

- [ ] **Step 3: Reduce `lib/venice.ts` to a pure factory**

Replace the whole file with (drops the `decrypt`/`prisma` imports, `createGetVeniceClient`, `getVeniceClient`, `GetVeniceClientDeps`; keeps the factory + error + constants):

```ts
// Single ingress to the Venice.ai OpenAI-compatible API. Pure client factory:
// no DB, no DEK, no crypto. The caller (venice-key.service) loads + decrypts the
// per-user BYOK key and hands the plaintext in for the lifetime of one request.

import OpenAI, { type ClientOptions } from 'openai';

export const DEFAULT_VENICE_BASE_URL = 'https://api.venice.ai/api/v1';

export interface VeniceClientOptions {
  apiKey: string;
  endpoint?: string | null;
}

export class NoVeniceKeyError extends Error {
  readonly code = 'venice_key_required';
  constructor(message = 'No Venice API key is configured for this user.') {
    super(message);
    this.name = 'NoVeniceKeyError';
  }
}

export function createVeniceClient({ apiKey, endpoint }: VeniceClientOptions): OpenAI {
  if (!apiKey) {
    throw new NoVeniceKeyError();
  }
  return new OpenAI({
    apiKey,
    baseURL: endpoint && endpoint.length > 0 ? endpoint : DEFAULT_VENICE_BASE_URL,
    fetch: ((url: string, init?: RequestInit) =>
      globalThis.fetch(url, init)) as unknown as ClientOptions['fetch'],
    maxRetries: 0,
  });
}
```

- [ ] **Step 4: Make `venice-key.service.ts` the single load+decrypt/encrypt site and add `getClient`**

In `backend/src/services/venice-key.service.ts`:

1. Swap the crypto import:
   - Remove: `import { decrypt, encrypt } from './crypto.service';`
   - Add: `import { decryptWithDek, encryptWithDek } from './content-crypto.service';`
   - Add: `import { createVeniceClient, NoVeniceKeyError, type VeniceClientOptions } from '../lib/venice';`
   - Add `import type OpenAI from 'openai';`

2. Extend the deps to carry the `buildClient` seam (moved off `lib/venice`):

```ts
export interface VeniceKeyServiceDeps {
  client?: PrismaClient;
  fetchFn?: typeof fetch;
  buildClient?: (options: VeniceClientOptions) => OpenAI;
}
```

3. Inside `createVeniceKeyService`, add `const buildClient = deps.buildClient ?? createVeniceClient;`

4. Thread `dek` into `getStatusAndKey` and switch to `decryptWithDek`:

```ts
async function getStatusAndKey(dek: Buffer, userId: string): Promise<StatusAndKey> {
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
    return { hasKey: false, lastSix: null, endpoint: null, apiKey: null };
  }

  const apiKey = decryptWithDek(dek, {
    ciphertext: row.veniceApiKeyEnc,
    iv: row.veniceApiKeyIv,
    authTag: row.veniceApiKeyAuthTag,
  });

  return {
    hasKey: true,
    lastSix: lastSixOf(apiKey),
    endpoint: row.veniceEndpoint ?? DEFAULT_VENICE_ENDPOINT,
    apiKey,
  };
}
```

5. Thread `dek` into `getStatus`, `getAccount`, and `store`, and switch `store` to `encryptWithDek`:

```ts
async function getStatus(dek: Buffer, userId: string): Promise<VeniceKeyStatus> {
  const { hasKey, lastSix, endpoint } = await getStatusAndKey(dek, userId);
  return { hasKey, lastSix, endpoint };
}

async function store(dek: Buffer, userId: string, rawInput: unknown): Promise<VeniceKeyStatus> {
  const input = storeVeniceKeyInputSchema.parse(rawInput);
  const endpoint = resolveEndpoint(input.endpoint);

  await validateAgainstVenice(input.apiKey, endpoint);

  const payload = encryptWithDek(dek, input.apiKey);

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
```

   Change the `getAccount` signature to `async function getAccount(dek: Buffer, userId: string)` and its first line to `const { hasKey, lastSix, endpoint, apiKey } = await getStatusAndKey(dek, userId);`. (Body otherwise unchanged.)

6. Add `getClient` and export it:

```ts
async function getClient(dek: Buffer, userId: string): Promise<OpenAI> {
  const { hasKey, apiKey, endpoint } = await getStatusAndKey(dek, userId);
  if (!hasKey || apiKey === null) {
    throw new NoVeniceKeyError();
  }
  return buildClient({ apiKey, endpoint });
}

return { getStatus, store, remove, validateAgainstVenice, getAccount, getClient };
```

   (`remove` keeps its `(userId)` signature — it NULLs columns, no DEK needed.)

- [ ] **Step 5: Repoint `venice.models.service.ts` onto the service + thread `dek`**

In `backend/src/services/venice.models.service.ts`:
- Replace `import { getVeniceClient } from '../lib/venice';` with `import { veniceKeyService } from './venice-key.service';`
- Change the deps type and default:

```ts
export interface VeniceModelsServiceDeps {
  getClient?: (dek: Buffer, userId: string) => Promise<OpenAI>;
  now?: () => number;
}
```
```ts
  const getClient = deps.getClient ?? veniceKeyService.getClient;
```
- Change `fetchModels` to take the DEK and pass it through (cache key stays `userId`):

```ts
  async function fetchModels(dek: Buffer, userId: string): Promise<ModelInfo[]> {
    const hit = byUser.get(userId);
    if (hit && now() - hit.fetchedAt < TTL_MS) {
      return hit.models;
    }

    const client = await getClient(dek, userId);
    const page = await client.models.list();
    const data = (page as unknown as { data: VeniceRawModel[] }).data ?? [];
    const models = data.filter((m) => (m.type ?? 'text') === 'text').map(mapModel);
    byUser.set(userId, { models, fetchedAt: now() });
    return models;
  }
```
- Leave `getModelContextLength`, `getModelMaxCompletionTokens`, `findModel`, `resetCache` **unchanged** — they are pure `byUser.get(userId)` cache reads and take no DEK.

- [ ] **Step 6: Thread `getDekFromRequest(req)` through the route call-sites**

In each route file, add `getDekFromRequest` to the existing `content-crypto.service` import (or add a new import), then:

`backend/src/routes/ai.routes.ts`
- Replace `import { getVeniceClient } from '../lib/venice';` with `import { veniceKeyService } from '../services/venice-key.service';`
- Add `import { getDekFromRequest } from '../services/content-crypto.service';` (this file does not import content-crypto today)
- L57: `await veniceModelsService.fetchModels(req.user!.id)` → `await veniceModelsService.fetchModels(getDekFromRequest(req), req.user!.id)`
- L82: `await veniceModelsService.fetchModels(userId)` → `await veniceModelsService.fetchModels(getDekFromRequest(req), userId)`
- L172: `const client = await getVeniceClient(userId);` → `const client = await veniceKeyService.getClient(getDekFromRequest(req), userId);`
- L53 comment: change "surfaces as NoVeniceKeyError from getVeniceClient" → "…from veniceKeyService.getClient".

`backend/src/routes/chat.routes.ts`
- Replace the `getVeniceClient` import with `import { veniceKeyService } from '../services/venice-key.service';`
- Add `import { getDekFromRequest } from '../services/content-crypto.service';` (this file does not import content-crypto today)
- L306: `await veniceModelsService.fetchModels(userId)` → `await veniceModelsService.fetchModels(getDekFromRequest(req), userId)`
- L438: `const client = await getVeniceClient(userId);` → `const client = await veniceKeyService.getClient(getDekFromRequest(req), userId);`

`backend/src/routes/chapters.routes.ts`
- Replace the `getVeniceClient` import with `import { veniceKeyService } from '../services/venice-key.service';`
- Add `import { getDekFromRequest } from '../services/content-crypto.service';` (this file does not import content-crypto today)
- L295: `await veniceModelsService.fetchModels(userId)` → `await veniceModelsService.fetchModels(getDekFromRequest(req), userId)`
- L356: `const client = await getVeniceClient(userId);` → `const client = await veniceKeyService.getClient(getDekFromRequest(req), userId);`

`backend/src/routes/venice-key.routes.ts`
- L32: `veniceKeyService.getStatus(req.user!.id)` → `veniceKeyService.getStatus(getDekFromRequest(req), req.user!.id)`
- L41: `veniceKeyService.store(req.user!.id, req.body)` → `veniceKeyService.store(getDekFromRequest(req), req.user!.id, req.body)`
- Add `import { getDekFromRequest } from '../services/content-crypto.service';`

`backend/src/routes/venice-account.routes.ts`
- L58: `veniceKeyService.getAccount(userId)` → `veniceKeyService.getAccount(getDekFromRequest(req), userId)`
- Add `import { getDekFromRequest } from '../services/content-crypto.service';`

Confirm `req` is in scope at each site (it is: `ai.routes.ts:71` `validateBody(CompleteBody, async (body, req, res) =>`; the others are `(req, res)` handlers).

- [ ] **Step 7: Fix the two broken test files, update stale comments, delete the relocated test**

1. `backend/tests/services/venice.models.service.test.ts` — add `import crypto from 'node:crypto';` and `const DEK = crypto.randomBytes(32);` near the top, then change all 19 `svc.fetchModels('user-1' | 'user-a' | 'user-b')` calls (lines 125–412) to pass the DEK first: `svc.fetchModels(DEK, 'user-1')`, etc. Leave the `getClient: async () => client` injections as-is — a zero-arg arrow is assignable to `(dek, userId) => …`.

2. `backend/tests/routes/venice-account.test.ts` — replace `import * as cryptoService from '../../src/services/crypto.service';` (L18) with `import * as contentCrypto from '../../src/services/content-crypto.service';`, and in the "decrypts exactly once" test change `vi.spyOn(cryptoService, 'decrypt')` (L357) to `vi.spyOn(contentCrypto, 'decryptWithDek')`. The `toBe(1)` assertion still holds (`getAccount → getStatusAndKey` decrypts once).

3. `backend/tests/ai/complete.test.ts:292,294` — update the two stale `getVeniceClient` references in those comment lines to `veniceKeyService.getClient` (L292 reads "from getVeniceClient, not from fetchModels"; L294 "getVeniceClient inside fetchModels will throw").

4. Delete the relocated test and confirm nothing references the removed symbols:

```bash
git rm backend/tests/lib/venice-per-user.test.ts
grep -rn "getVeniceClient\|createGetVeniceClient" backend/src backend/tests --include="*.ts"
```
Expected: the grep returns **nothing** (the only remaining hits were the two `complete.test.ts` comments, fixed in sub-step 3).

- [ ] **Step 8: Typecheck + run the affected suites**

```bash
npm --prefix backend run typecheck
npm -w story-editor-backend run test -- tests/services/venice-key.getClient.test.ts tests/services/venice.models.service.test.ts tests/routes/venice-key.test.ts tests/routes/venice-account.test.ts tests/routes/chapters.summarise.test.ts tests/routes/chapters.summary-put.test.ts tests/ai tests/security/byok-leak.test.ts
```
Expected: PASS. The login-based integration tests (`venice-key`, `byok-leak`, `ai/*`, `chapters.summarise`/`summary-put`) pass with no scheme edits — they carry a real DEK. The two edited unit tests (`venice.models.service`, the `venice-account` spy) pass because of Step 7. (Step 8's green does not by itself prove the chapters AI path — the final full-suite run is the backstop.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "[<BD_ID>] encrypt BYOK Venice key under the content DEK; consolidate to veniceKeyService.getClient; reduce lib/venice to a factory"
```

---

## Task 2: Delete `crypto.service.ts`, the boot validator, and the `APP_ENCRYPTION_KEY` env wiring

After Task 1, `crypto.service.ts` has no importers. Remove it and everything that exists only to load/validate `APP_ENCRYPTION_KEY`.

**Files:**
- Delete: `backend/src/services/crypto.service.ts`, `backend/tests/services/crypto.service.test.ts`
- Modify: `backend/src/boot/env-validation.ts` (reduce to stale-key warning) + rewrite `backend/tests/boot/encryption-keys.test.ts`
- Modify: `backend/tests/setup.ts:11`
- Modify: `backend/tests/security/encryption-leak.test.ts:248-249`
- Modify: `.env.example:18`

(`backend/src/index.ts` is **not** modified — it imports only `validateEncryptionEnv`, which stays. The removed `BootValidationError` / `APP_ENCRYPTION_KEY_BYTES` exports are imported solely by `encryption-keys.test.ts`, which Step 3 rewrites; `typecheck` confirms no other importer.)

- [ ] **Step 1: Confirm only `crypto.service`'s own test still imports it, then delete both**

```bash
grep -rn "services/crypto.service'" backend/src backend/tests --include="*.ts" | grep -v content-crypto
```
Expected: a single hit — `backend/tests/services/crypto.service.test.ts`. (Src importers and `venice-per-user.test.ts` went away in Task 1; `venice-account.test.ts`'s import was swapped in Task 1.) Then delete the service + its test:
```bash
git rm backend/src/services/crypto.service.ts backend/tests/services/crypto.service.test.ts
```

- [ ] **Step 2: Reduce the boot validator to a stale-key warning**

Replace `backend/src/boot/env-validation.ts` with a no-required-key version that only warns on leftover vars:

```ts
// Boot-time environment check. There is no longer a required encryption env
// secret: the BYOK Venice key is wrapped by the per-user content DEK, and
// narrative content by user-credential-derived wraps (see docs/encryption.md).
// We only warn if a now-unused key lingers in a stale .env.

export interface ValidateOptions {
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
}

export function validateEncryptionEnv(opts: ValidateOptions = {}): void {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((m) => console.warn(m));

  if (env.APP_ENCRYPTION_KEY) {
    warn(
      '[boot] APP_ENCRYPTION_KEY is set but no longer used. The BYOK Venice key ' +
        'is now wrapped by the per-user content DEK (docs/encryption.md). ' +
        'Remove it from your .env.',
    );
  }
  if (env.CONTENT_ENCRYPTION_KEY) {
    warn(
      '[boot] CONTENT_ENCRYPTION_KEY is set but unused. The envelope scheme ' +
        'derives content DEKs from user credentials (docs/encryption.md). ' +
        'Remove it from your .env to avoid confusion.',
    );
  }
}
```

   `backend/src/index.ts` keeps `import { validateEncryptionEnv } from './boot/env-validation';` and the `validateEncryptionEnv();` call (now non-fatal) — no change needed there. Remove the `APP_ENCRYPTION_KEY_BYTES`/`BootValidationError` exports (they're gone above).

- [ ] **Step 3: Rewrite the boot test to assert the warnings (not a required-key throw)**

Replace `backend/tests/boot/encryption-keys.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';
import { validateEncryptionEnv } from '../../src/boot/env-validation';

describe('validateEncryptionEnv() — no required encryption env secret', () => {
  it('does not throw when no encryption env vars are set', () => {
    expect(() => validateEncryptionEnv({ env: {} as NodeJS.ProcessEnv })).not.toThrow();
  });

  it('warns (does not throw) if a stale APP_ENCRYPTION_KEY lingers', () => {
    const warn = vi.fn();
    validateEncryptionEnv({ env: { APP_ENCRYPTION_KEY: 'leftover' } as NodeJS.ProcessEnv, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/APP_ENCRYPTION_KEY/));
  });

  it('warns if a stale CONTENT_ENCRYPTION_KEY lingers', () => {
    const warn = vi.fn();
    validateEncryptionEnv({ env: { CONTENT_ENCRYPTION_KEY: 'leftover' } as NodeJS.ProcessEnv, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/CONTENT_ENCRYPTION_KEY/));
  });
});
```

- [ ] **Step 4: Drop the `APP_ENCRYPTION_KEY` test-env wiring**

- `backend/tests/setup.ts:11` — delete the line `process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 0xab).toString('base64');`
- `backend/tests/security/encryption-leak.test.ts:248-249` — delete the `APP_ENCRYPTION_KEY:` property from the spawned seed child's `env` object (keep `JWT_SECRET` / `REFRESH_TOKEN_SECRET`).

- [ ] **Step 5: Remove `APP_ENCRYPTION_KEY` from `.env.example`**

Delete line 18 (`APP_ENCRYPTION_KEY=change-me-to-a-base64-encoded-32-byte-key`) and any now-orphaned comment block introducing it.

- [ ] **Step 6: Typecheck + run boot + leak suites**

```bash
npm --prefix backend run typecheck
npm -w story-editor-backend run test -- tests/boot/encryption-keys.test.ts tests/security/encryption-leak.test.ts tests/security/byok-leak.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "[<BD_ID>] delete crypto.service + APP_ENCRYPTION_KEY boot validation and env wiring"
```

---

## Task 3: Data migration — drop the now-unreadable Venice-key ciphertext

**Files:**
- Create: `backend/prisma/migrations/<timestamp>_drop_venice_key_ciphertext/migration.sql`

- [ ] **Step 1: Scaffold an empty migration (schema diff is empty)**

```bash
npm -w story-editor-backend exec -- prisma migrate dev --create-only --name drop_venice_key_ciphertext
```
This creates the timestamped folder with an **empty** `migration.sql` (no schema change to diff).

- [ ] **Step 2: Hand-write the data migration**

Put this in the generated `migration.sql`:

```sql
-- Data-only: APP_ENCRYPTION_KEY is gone, so existing veniceApiKey ciphertext is
-- unreadable. Drop it; users re-enter their BYOK key once (it is now wrapped by
-- the per-user content DEK). Touches no narrative columns.
UPDATE "User"
SET "veniceApiKeyEnc" = NULL,
    "veniceApiKeyIv" = NULL,
    "veniceApiKeyAuthTag" = NULL;
```

- [ ] **Step 3: Apply + verify**

```bash
npm -w story-editor-backend exec -- prisma migrate dev
```
Expected: migration applies cleanly (on a dev DB with no stored keys it NULLs already-null columns — a no-op, which is correct). **No Prisma-client regen or backend restart needed** — this is data-only with no schema delta, so the dev-container client-drift gotcha (which applies to *schema* migrations) doesn't apply here.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/migrations
git commit -m "[<BD_ID>] migration: drop unreadable Venice-key ciphertext (re-enter on next login)"
```

---

## Task 4: Documentation

Prose only — no build impact. Make these edits, then commit once.

- [ ] **Step 1: `docs/encryption.md`** — Goal 2 (env leak no longer reveals Venice keys) and Goal 4 (losing `APP_ENCRYPTION_KEY` no longer loses Venice keys — the key is gone); the threat-model table — flip **both** "DB dump + user's password" (`:272`) and "DB dump + user's recovery code" (`:273`) Venice-key cells from ❌ to ✅, and change the "DB dump + `APP_ENCRYPTION_KEY` (env leak)" row to note there is no such key; rewrite "What `APP_ENCRYPTION_KEY` actually wraps" to "Removed — the Venice key is wrapped by the per-user DEK"; in Revisit #1 note `APP_ENCRYPTION_KEY` no longer exists by default but would be re-introduced for offline decrypt; add a Change-log entry dated 2026-06-15.

- [ ] **Step 2: `docs/data-model.md`** — L5 and L180: change "`APP_ENCRYPTION_KEY` protects the BYOK Venice keys only and has no authority over narrative content" to state the Venice key is now wrapped by the per-user content DEK and there is no server-held encryption key; update the `User` model's `veniceApiKey*` annotation to "AES-256-GCM under the per-user DEK".

- [ ] **Step 3: `docs/agent-rules/backend.md`** — L191/199/203/205/241: drop "`APP_ENCRYPTION_KEY` is the only server-held encryption env secret"; state there is no server-held encryption env secret; in the no-leak list keep passwords/recovery codes/DEKs and remove the `APP_ENCRYPTION_KEY` clause.

- [ ] **Step 4: `docs/agent-rules/repo-boundary.md`** — L90/183: remove the `APP_ENCRYPTION_KEY` / `CONTENT_ENCRYPTION_KEY` policy references (or reduce to "no server-held encryption key").

- [ ] **Step 5: `docs/agent-rules/index.md` + `docs/agent-workflow.md`** — remove the `crypto.service.ts` rows from the rules-routing / touch-set tables.

- [ ] **Step 6: `.claude/agents/security-reviewer.md`** — re-point its in-lane list off `crypto.service.ts` + the `APP_ENCRYPTION_KEY` bootstrap and onto `venice-key.service.ts` (the single decrypt/encrypt site) + `content-crypto.service.ts`.

- [ ] **Step 7: `.claude/agents/repo-boundary-reviewer.md`** — L28/102: drop the `crypto.service.ts` mentions.

- [ ] **Step 8: `SELF_HOSTING.md`** — rewrite §1 (L11-23): remove the `APP_ENCRYPTION_KEY` requirement; state there is no server-held encryption key. Update the key table (L77), the BYOK note (L95), the `.env` template comments (L114/163/168), and the backup section (L223). Add the upgrade note: *"After upgrading to this version, each user re-enters their Venice API key once in Settings; `APP_ENCRYPTION_KEY` is no longer needed and can be removed from your `.env`."*

- [ ] **Step 9: `CLAUDE.md`** — update the General-rules bullets about `APP_ENCRYPTION_KEY` / `CONTENT_ENCRYPTION_KEY`, the BYOK gotcha, the "When to Stop and Ask" `APP_ENCRYPTION_KEY`-rotation bullet, and drop `crypto.service.ts` from the `security-reviewer` in-lane file list.

- [ ] **Step 10: `docs/venice-integration.md`** — L11: one-line clarification that the BYOK key is wrapped by the per-user DEK (not a server key).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "[<BD_ID>] docs: retire APP_ENCRYPTION_KEY; Venice key now under the content DEK"
```

Leave untouched (immutable / point-in-time): `docs/done/done-*.md`, all closed `docs/superpowers/plans/*` and `specs/*` except this plan + its spec, `docs/multi-agent-workflow-plan.md`, `docs/api-contract.md`.

---

## Task 5: Infra / CI / scripts

**Files:**
- `.github/workflows/ci.yml:42,145`
- `scripts/backup-restore-drill.sh:97-98,131,234`
- `scripts/backup-db.sh:16`
- `docker-compose.release.yml:15`
- `.github/workflows/secret-scan.yml:12`
- `backend/src/lib/venice-errors.ts:281`
- `scripts/bd-close-reviewed.sh:138`

- [ ] **Step 1: CI** — `.github/workflows/ci.yml`: remove the `export APP_ENCRYPTION_KEY=…` line (L145) and the comment (L42). Tests no longer require it (Task 2 removed the synth + the only consumer).

- [ ] **Step 2: Backup-restore drill** — `scripts/backup-restore-drill.sh`: remove the key generation (L97-98) and the two `-e APP_ENCRYPTION_KEY \` docker args (L131, L234). Then dry-run the drill (or read it through) to confirm nothing else references the var.

- [ ] **Step 3: Comments/templates** — `scripts/backup-db.sh:16`, `docker-compose.release.yml:15`, `.github/workflows/secret-scan.yml:12`: drop `APP_ENCRYPTION_KEY` from these comment/threat-model lines.

- [ ] **Step 4: Stale code comment** — `backend/src/lib/venice-errors.ts:281`: remove `APP_ENCRYPTION_KEY` from the "none of these are in the Venice exchange" list (keep passwords / recovery codes / DEKs).

- [ ] **Step 5: Close-gate matcher** — `scripts/bd-close-reviewed.sh:138`: remove the `services/crypto` alternative from the `security-reviewer` path-matcher regex (the file is deleted; `content-crypto` is matched separately and stays).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "[<BD_ID>] infra/ci/scripts: drop APP_ENCRYPTION_KEY wiring and stale references"
```

---

## Final verification (whole change)

- [ ] `make typecheck` — passes (shared + backend + frontend).
- [ ] `make dev` up, then `npm -w story-editor-backend run test` — full backend suite passes.
- [ ] `grep -rn "APP_ENCRYPTION_KEY" backend/src .env.example` — returns only the intentional stale-key boot-warning string in `env-validation.ts`; nothing in `.env.example`.
- [ ] `grep -rn "getVeniceClient\|crypto.service'" backend/src --include="*.ts" | grep -v content-crypto` — returns nothing.
- [ ] Manual: with `APP_ENCRYPTION_KEY` **unset** in the env, `make dev`, register/log in, store a Venice key in Settings, run an AI completion, and load the Settings account-balance pill — all succeed.
- [ ] Close gate: `/bd-close-reviewed <BD_ID>` dispatches `security-reviewer` (venice-key.service / lib/venice / content-crypto / bootstrap) and `repo-boundary-reviewer` (content-crypto) — both must clear.

---

## Self-review (completed by plan author)

- **Spec coverage:** Goal 1 → Task 1 (encryptWithDek/decryptWithDek). Goal 2 → Task 2 (delete key + validator). Goal 3 (no-leak) → Task 1 fail-closed test + unchanged `byok-leak.test.ts`. Goal 4 (single decrypt site + factory) → Task 1. Migration → Task 3. Threat-model + docs → Task 4. Infra → Task 5. All spec "Files to change" entries map to a task, except `tests/models/user-venice-key.test.ts` (spec listed it for update) which **intentionally needs no change** — it's a Prisma storage round-trip of opaque base64, not an encryption-scheme assertion.
- **Placeholder scan:** none — every code step shows complete code; mechanical edits give exact before→after + line numbers.
- **Type consistency:** `getClient(dek, userId)`, `fetchModels(dek, userId)`, `getStatusAndKey/getStatus/getAccount/store(dek, …)`, and `VeniceModelsServiceDeps.getClient(dek, userId)` use the same `dek: Buffer` first-arg ordering across service, models-service, routes, and tests. `buildClient` seam name matches between `VeniceKeyServiceDeps` and the test.
- **Green-at-each-commit:** Task 1 is atomic (scheme flip can't be partial); Tasks 2-5 each leave the suite green (crypto.service is importer-free after Task 1; migration/docs/infra don't break the build).
