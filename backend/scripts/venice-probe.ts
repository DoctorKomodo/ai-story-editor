/**
 * venice-probe — L-series dev-only CLI for testing Venice.ai connectivity.
 *
 * Usage:
 *   npm run venice:probe -- --help
 *   npm run venice:probe -- --models
 *   npm run venice:probe -- --prompt "Say hello" [--model llama-3.3-70b]
 *   npm run venice:probe -- --prompt "Say hello" --stream [--model llama-3.3-70b]
 *
 * Requires backend/.env.live (gitignored). Copy backend/.env.live.example and
 * fill in a SPENDING-CAPPED Venice API key before running.
 *
 * DEV-ONLY — no production code path imports this file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const USAGE = `
venice-probe — dev-only CLI for testing Venice.ai connectivity

Usage:
  npm run venice:probe -- [options]

Options:
  --help                Print this help text
  --models              List available text models as JSON
  --prompt <text>       Send a non-streaming chat completion (default model)
  --stream              Combine with --prompt: stream SSE chunks to stdout
  --model <id>          Override the model (default: LIVE_VENICE_MODEL env var)

Examples:
  npm run venice:probe -- --models
  npm run venice:probe -- --prompt "Say hi"
  npm run venice:probe -- --prompt "Tell me a story" --stream --model llama-3.3-70b

Requires: backend/.env.live with LIVE_VENICE_API_KEY set.
See backend/.env.live.example for the full variable list.
`.trim();

// ---------------------------------------------------------------------------
// Parse args early so --help works without .env.live
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: 'boolean', default: false },
    models: { type: 'boolean', default: false },
    prompt: { type: 'string' },
    stream: { type: 'boolean', default: false },
    model: { type: 'string' },
  },
  allowPositionals: true,
  strict: true,
});

if (values.help || (positionals.length === 0 && !values.models && !values.prompt)) {
  console.log(USAGE);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Load .env.live — only needed for actual Venice operations.
// When invoked via `npm run venice:probe` from inside `backend/`, cwd is
// `backend/`, so the relative path is just `.env.live`.
// ---------------------------------------------------------------------------

const envLivePath = path.resolve(process.cwd(), '.env.live');

if (!fs.existsSync(envLivePath)) {
  console.error(
    'error: backend/.env.live is missing — copy backend/.env.live.example and fill in values',
  );
  process.exit(2);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: envLivePath });

if (!process.env.LIVE_VENICE_API_KEY) {
  console.error(
    'error: backend/.env.live is missing — copy backend/.env.live.example and fill in values',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Venice client — import AFTER env is loaded.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createVeniceClient } = require('../src/lib/venice') as typeof import('../src/lib/venice');

async function main(): Promise<void> {
  const apiKey = process.env.LIVE_VENICE_API_KEY as string;
  const endpoint = process.env.LIVE_VENICE_ENDPOINT ?? undefined;
  const defaultModel = process.env.LIVE_VENICE_MODEL ?? 'llama-3.3-70b';
  const model = values.model ?? defaultModel;

  const client = createVeniceClient({ apiKey, endpoint });

  if (values.models) {
    const page = await client.models.list();
    const textModels = page.data.filter((m: Record<string, unknown>) => m.type === 'text');
    console.log(JSON.stringify(textModels, null, 2));
    return;
  }

  if (values.prompt) {
    const userContent = values.prompt;

    if (values.stream) {
      // Streaming path
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: userContent }],
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          process.stdout.write(delta);
        }
      }
      process.stdout.write('\n');
    } else {
      // Non-streaming path
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: userContent }],
        stream: false,
      });

      const content = completion.choices[0]?.message?.content ?? '';
      console.log(content);
    }
    return;
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // Never log the key — just the error summary.
  console.error(`error: ${message}`);
  process.exit(1);
});
