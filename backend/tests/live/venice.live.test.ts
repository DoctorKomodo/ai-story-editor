/**
 * Live Venice.ai integration tests — L-series (dev-only, opt-in).
 *
 * !! These tests make real HTTP requests to Venice.ai and consume API credits !!
 * They are excluded from the default test suite (`npm run test:backend`) and
 * from CI. Run explicitly with:
 *
 *   cd backend && npm run test:live
 *
 * Requires `backend/.env.live` to be present with LIVE_VENICE_API_KEY set
 * (copy `backend/.env.live.example` and fill in a SPENDING-CAPPED key).
 *
 * Without a key, every test in this file is silently skipped via
 * `it.skipIf(!process.env.LIVE_VENICE_API_KEY)`.
 */

import path from 'node:path';
import dotenv from 'dotenv';
import { beforeAll, describe, expect, it } from 'vitest';
import { createVeniceClient } from '@/lib/venice';

// Load .env.live relative to `backend/` (the vitest cwd for this config).
// If the file doesn't exist, dotenv.config is a no-op and
// process.env.LIVE_VENICE_API_KEY stays undefined → all tests skip.
dotenv.config({ path: path.resolve(process.cwd(), '.env.live') });

const hasKey = Boolean(process.env.LIVE_VENICE_API_KEY);

const skipUnlessKey = it.skipIf(!hasKey);

describe('Venice.ai live integration tests', () => {
  // -------------------------------------------------------------------------
  // Client setup — only runs when we actually have a key (tests not skipped).
  // -------------------------------------------------------------------------
  let client: ReturnType<typeof createVeniceClient>;

  beforeAll(() => {
    if (!hasKey) return;
    client = createVeniceClient({
      apiKey: process.env.LIVE_VENICE_API_KEY as string,
      endpoint: process.env.LIVE_VENICE_ENDPOINT ?? undefined,
    });
  });

  const model = () => process.env.LIVE_VENICE_MODEL ?? 'llama-3.3-70b';

  // -------------------------------------------------------------------------
  // Test 1: GET /v1/models returns a non-empty text-model list
  // -------------------------------------------------------------------------
  skipUnlessKey('GET /v1/models returns a non-empty text-model list', async () => {
    const page = await client.models.list();

    expect(Array.isArray(page.data)).toBe(true);

    const textModels = page.data.filter((m) => (m as Record<string, unknown>).type === 'text');

    expect(textModels.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: Non-streaming completion returns a non-empty string
  // -------------------------------------------------------------------------
  skipUnlessKey('non-streaming completion returns a non-empty string', async () => {
    const completion = await client.chat.completions.create({
      model: model(),
      messages: [{ role: 'user', content: 'Say hi.' }],
      stream: false,
    });

    const content = completion.choices[0]?.message?.content;
    expect(typeof content).toBe('string');
    expect((content as string).length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: Streaming completion yields ≥1 SSE delta then completes cleanly.
  // The OpenAI SDK consumes the [DONE] sentinel internally; the assertion is
  // that the async iterator ends normally after yielding ≥1 content chunk.
  // -------------------------------------------------------------------------
  skipUnlessKey('streaming completion yields ≥1 SSE delta then completes cleanly', async () => {
    const stream = await client.chat.completions.create({
      model: model(),
      messages: [{ role: 'user', content: 'Say hi.' }],
      stream: true,
    });

    let chunkCount = 0;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        chunkCount += 1;
      }
    }

    // Stream completed without throwing — and we saw at least one delta.
    expect(chunkCount).toBeGreaterThanOrEqual(1);
  });
});
