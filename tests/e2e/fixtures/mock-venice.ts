import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * In-process mock Venice endpoint speaking the OpenAI-compatible API surface
 * the per-user Venice client (`backend/src/lib/venice.ts:createVeniceClient`)
 * targets at the user's stored `endpoint` URL.
 *
 * The mock binds to all interfaces so the dockerised backend can reach it
 * via `host.docker.internal:<port>` (see `extra_hosts` in
 * `docker-compose.override.yml`).
 *
 * Routes implemented:
 *   GET  /models                    — verify-key probe (returns 1 model)
 *   POST /chat/completions          — streams a deterministic SSE response
 *
 * Notes:
 *  - Venice's BYOK key validation calls `/models`; the mock accepts any
 *    `Authorization: Bearer …` (including the test's fake key).
 *  - Chat completions stream three deltas + a `[DONE]` terminator + a
 *    final usage frame, mirroring Venice's tail-usage convention. The
 *    fixed token counts let the spec assert a usage delta on the UI.
 *  - All bytes are flushed (`res.flushHeaders()` + `res.write` per frame
 *    + per-frame `\r\n` terminator) so nginx's SSE-friendly proxy config
 *    forwards each frame promptly.
 */

const STREAMED_DELTAS = ['The ', 'rain ', 'fell.'];
const PROMPT_TOKENS = 12;
const COMPLETION_TOKENS = 7;
// Venice surfaces rate-limit budgets via `x-ratelimit-remaining-*` headers;
// the backend forwards them onto `x-venice-remaining-*` for the frontend's
// UsageIndicator. Fixed values let the spec assert exact UI text.
const REMAINING_REQUESTS = 4242;
const REMAINING_TOKENS = 987654;

export interface MockVeniceServer {
  baseURL: string;
  containerBaseURL: string;
  close(): Promise<void>;
  reset(): void;
  callCount(): number;
}

export async function startMockVenice(): Promise<MockVeniceServer> {
  let calls = 0;

  const server: Server = createServer((req, res) => {
    const url = req.url ?? '';

    if (req.method === 'GET' && (url === '/models' || url === '/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [
            {
              id: 'mock-model',
              object: 'model',
              created: Math.floor(Date.now() / 1000),
              owned_by: 'mock-venice',
              context_length: 8192,
              model_spec: {
                availableContextTokens: 8192,
                pricing: { input: 0, output: 0 },
                capabilities: { supportsResponseSchema: false, supportsVision: false },
              },
            },
          ],
        }),
      );
      return;
    }

    if (req.method === 'POST' && (url === '/chat/completions' || url === '/v1/chat/completions')) {
      calls += 1;
      // Drain the request body so the socket doesn't hang on keep-alive.
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'x-ratelimit-remaining-requests': String(REMAINING_REQUESTS),
          'x-ratelimit-remaining-tokens': String(REMAINING_TOKENS),
        });
        res.flushHeaders();

        const id = `chatcmpl-mock-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        for (const delta of STREAMED_DELTAS) {
          const frame = {
            id,
            object: 'chat.completion.chunk',
            created,
            model: 'mock-model',
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(frame)}\n\n`);
        }

        // Final frame with a finish_reason and aggregated usage. Venice's
        // tail frame includes a usage object — the SDK exposes it as the
        // last chunk's `.usage`, which the AI route forwards for the UI's
        // UsageIndicator.
        const finalFrame = {
          id,
          object: 'chat.completion.chunk',
          created,
          model: 'mock-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: PROMPT_TOKENS,
            completion_tokens: COMPLETION_TOKENS,
            total_tokens: PROMPT_TOKENS + COMPLETION_TOKENS,
          },
        };
        res.write(`data: ${JSON.stringify(finalFrame)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: { message: `mock-venice: no route for ${req.method} ${url}` } }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    // Host-side URL (Playwright spec runs on the host).
    baseURL: `http://127.0.0.1:${port}`,
    // Container-side URL (the dockerised backend reaches the host via
    // host.docker.internal — opted in via extra_hosts in the override).
    containerBaseURL: `http://host.docker.internal:${port}`,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
    reset(): void {
      calls = 0;
    },
    callCount(): number {
      return calls;
    },
  };
}
