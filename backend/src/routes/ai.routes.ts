import { createHash } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { getVeniceClient } from '../lib/venice';
import { veniceModelsService } from '../services/venice.models.service';
import { buildPrompt, type CharacterContext } from '../services/prompt.service';
import { createStoryRepo } from '../repos/story.repo';
import { createChapterRepo } from '../repos/chapter.repo';
import { createCharacterRepo } from '../repos/character.repo';
import { tipTapJsonToText } from '../services/tiptap-text';
import { mapVeniceError, mapVeniceErrorToSse } from '../lib/venice-errors';

// ─── Request body schema ──────────────────────────────────────────────────────

const CompleteBody = z
  .object({
    // 'ask' is intentionally excluded: it routes into chat (V16), not /complete.
    // 'rewrite' and 'describe' are V14 additions for the selection-bubble surface.
    action: z.enum(['continue', 'rephrase', 'expand', 'summarise', 'freeform', 'rewrite', 'describe']),
    selectedText: z.string(),
    chapterId: z.string().min(1),
    storyId: z.string().min(1),
    modelId: z.string().min(1),
    freeformInstruction: z.string().optional(),
    enableWebSearch: z.boolean().optional(),
  })
  .refine(
    (d) => d.action !== 'freeform' || (typeof d.freeformInstruction === 'string' && d.freeformInstruction.length > 0),
    { message: 'freeformInstruction is required when action is "freeform"', path: ['freeformInstruction'] },
  );

// ─── Prompt-cache key helper ──────────────────────────────────────────────────

// [V8] Deterministic per (storyId, modelId). Hash is sha256 hex, truncated to
// 32 chars so it stays readable in Venice's telemetry without leaking content.
function promptCacheKey(storyId: string, modelId: string): string {
  return createHash('sha256').update(`${storyId}:${modelId}`).digest('hex').slice(0, 32);
}

// ─── settingsJson type helper ────────────────────────────────────────────────

interface AiSettings {
  includeVeniceSystemPrompt?: boolean;
}

interface UserSettings {
  ai?: AiSettings;
}

function resolveIncludeVeniceSystemPrompt(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return true;
  const settings = raw as UserSettings;
  const flag = settings.ai?.includeVeniceSystemPrompt;
  if (typeof flag === 'boolean') return flag;
  return true;
}

export function createAiRouter() {
  const router = Router();

  router.use(requireAuth);

  // [V1] GET /api/ai/models — list text models the caller's BYOK key can see,
  // mapped to { id, name, contextLength, supportsReasoning, supportsVision }.
  // Cached in-memory for 10 minutes by the models service. A missing key
  // surfaces as NoVeniceKeyError from getVeniceClient, which the global error
  // handler maps to 409 { error: "venice_key_required" }.
  router.get('/models', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const models = await veniceModelsService.fetchModels(req.user!.id);
      res.status(200).json({ models });
    } catch (err) {
      if (mapVeniceError(err, res, req.user!.id)) return;
      next(err);
    }
  });

  // [V10] GET /api/ai/balance — reads x-venice-balance-usd and x-venice-balance-diem
  // from Venice response headers via a lightweight models.list() call.
  // Does NOT use the models service cache (balance must be fresh).
  // Returns { credits: number | null, diem: number | null }.
  router.get('/balance', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = await getVeniceClient(req.user!.id);
      // .withResponse() gives us the raw HTTP response so we can read
      // balance headers even though the openai SDK doesn't type them.
      const { response } = await client.models.list().withResponse();
      const rawUsd = response.headers.get('x-venice-balance-usd');
      const rawDiem = response.headers.get('x-venice-balance-diem');
      const credits = rawUsd !== null ? parseFloat(rawUsd) : null;
      const diem = rawDiem !== null ? parseFloat(rawDiem) : null;
      res.status(200).json({ credits, diem });
    } catch (err) {
      if (mapVeniceError(err, res, req.user!.id)) return;
      next(err);
    }
  });

  // [V5] POST /api/ai/complete — streams AI completions back as SSE.
  // [V6] reasoning flag — strip_thinking_response for supportsReasoning models.
  // [V7] web-search flag — enable_web_search + enable_web_citations.
  // [V8] prompt-cache key — sha256(storyId:modelId) truncated to 32 hex chars.
  router.post('/complete', async (req: Request, res: Response, next: NextFunction) => {
    // ── 1. Validate request body ─────────────────────────────────────────────
    const parsed = CompleteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: 'Invalid request', code: 'invalid_request', details: parsed.error.flatten() } });
      return;
    }
    const body = parsed.data;
    const userId = req.user!.id;

    try {
      // ── 2. Prime models cache + get context length ───────────────────────
      // fetchModels throws NoVeniceKeyError when user has no BYOK key → 409.
      // Called before any DB reads so a missing BYOK key surfaces immediately
      // without leaking whether the story/chapter exists (per spec: step 6
      // runs "first"). Also throws UnknownModelError when modelId isn't in
      // Venice's list → propagates as 500 (V11 will refine later).
      await veniceModelsService.fetchModels(userId);
      const modelContextLength = veniceModelsService.getModelContextLength(body.modelId);

      // ── 3. Load user settings (not a narrative entity — direct prisma ok) ──
      const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { settingsJson: true },
      });
      const includeVeniceSystemPrompt = resolveIncludeVeniceSystemPrompt(
        userRow?.settingsJson ?? null,
      );

      // ── 4. Load story via repo (ownership-scoped) ────────────────────────
      const story = await createStoryRepo(req).findById(body.storyId);
      if (!story) {
        res.status(404).json({ error: { message: 'Story not found', code: 'not_found' } });
        return;
      }

      // ── 5. Load chapter via repo + cross-check storyId ───────────────────
      const chapter = await createChapterRepo(req).findById(body.chapterId);
      if (!chapter || chapter.storyId !== body.storyId) {
        res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
        return;
      }

      // ── 6. Load characters ────────────────────────────────────────────────
      const rawCharacters = await createCharacterRepo(req).findManyForStory(body.storyId);

      // ── 7. Map characters to CharacterContext ────────────────────────────
      const characters: CharacterContext[] = rawCharacters.map((c) => {
        const nameVal = typeof c.name === 'string' ? c.name : '';
        const roleVal = typeof c.role === 'string' ? c.role : null;
        // Condense traits: combine available trait fields into a short string.
        const traitFields = ['personality', 'arc', 'appearance', 'voice'] as const;
        const traitParts: string[] = [];
        for (const f of traitFields) {
          const v = (c as Record<string, unknown>)[f];
          if (typeof v === 'string' && v.trim().length > 0) {
            traitParts.push(v.trim());
          }
          if (traitParts.join('; ').length >= 120) break;
        }
        const keyTraits = traitParts.join('; ').slice(0, 120) || null;
        return { name: nameVal, role: roleVal, keyTraits };
      });

      // ── 8. Extract chapter plaintext from decrypted TipTap body ──────────
      const chapterContent = tipTapJsonToText(chapter.body ?? null);

      // ── 9. Build prompt ───────────────────────────────────────────────────
      const worldNotes = typeof story.worldNotes === 'string' ? story.worldNotes : null;
      const storySystemPrompt = typeof story.systemPrompt === 'string' ? story.systemPrompt : null;

      const { messages, venice_parameters: baseVeniceParams, max_completion_tokens } = buildPrompt({
        action: body.action,
        selectedText: body.selectedText,
        chapterContent,
        characters,
        worldNotes,
        modelContextLength,
        includeVeniceSystemPrompt,
        storySystemPrompt,
        freeformInstruction: body.freeformInstruction,
      });

      // ── 10. Enrich venice_parameters ─────────────────────────────────────
      const venice_parameters: Record<string, unknown> = { ...baseVeniceParams };

      // [V6] Reasoning model: strip chain-of-thought tokens
      const modelInfo = veniceModelsService.findModel(body.modelId);
      if (modelInfo?.supportsReasoning === true) {
        venice_parameters.strip_thinking_response = true;
      }

      // [V7] Web search
      if (body.enableWebSearch === true) {
        venice_parameters.enable_web_search = 'auto';
        venice_parameters.enable_web_citations = true;
      }

      // ── 11. Get the Venice client ─────────────────────────────────────────
      const client = await getVeniceClient(userId);

      // ── 12. Call Venice with streaming ────────────────────────────────────
      // [V9] Use .withResponse() so we can read rate-limit headers from the
      // HTTP response before the body streams. The SDK returns headers as soon
      // as the response status line arrives, before any body bytes.
      // `venice_parameters` is not in the openai SDK types; cast through
      // unknown at the call site. Also cast .withResponse() return so TS
      // treats `data` as AsyncIterable<ChatCompletionChunk> (stream: true
      // guarantees this at runtime but the overload union obscures it).
      // [V8/V23] `prompt_cache_key` is a Venice top-level field (sibling of
      // `model` / `messages` / `stream`), NOT nested under `venice_parameters`.
      // Deterministic per (storyId, modelId).
      const streamWithResp = await (
        client.chat.completions.create({
          model: body.modelId,
          messages,
          stream: true as const,
          max_completion_tokens,
          prompt_cache_key: promptCacheKey(body.storyId, body.modelId),
          venice_parameters,
        } as unknown as Parameters<typeof client.chat.completions.create>[0])
      ).withResponse() as unknown as {
        data: AsyncIterable<{ choices: Array<{ delta: { content?: string }; finish_reason: string | null }> }>;
        // Fetch API Response (not Express Response) — use structural type to avoid
        // the import collision between Express.Response and globalThis.Response.
        response: { headers: { get(name: string): string | null } };
      };
      const { data: stream, response: veniceResponse } = streamWithResp;

      // ── 13. Write SSE response ────────────────────────────────────────────
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      // [V9] Forward Venice rate-limit headers to the client so the frontend
      // can display usage. Only set when Venice actually sent them.
      const remainingRequests = veniceResponse.headers.get('x-ratelimit-remaining-requests');
      const remainingTokens = veniceResponse.headers.get('x-ratelimit-remaining-tokens');
      if (remainingRequests !== null) {
        res.setHeader('x-venice-remaining-requests', remainingRequests);
      }
      if (remainingTokens !== null) {
        res.setHeader('x-venice-remaining-tokens', remainingTokens);
      }

      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      // Headers are now committed — all errors from this point must be written
      // as terminal SSE frames; Express's global error handler can no longer
      // send an HTTP error response.

      // Stop iteration cleanly when the client disconnects mid-stream.
      let clientClosed = false;
      req.on('close', () => {
        clientClosed = true;
        // Best-effort abort of the Venice stream so we don't leak an open
        // connection upstream.
        try {
          (stream as unknown as { controller?: { abort?: () => void } }).controller?.abort?.();
        } catch {
          // Ignore — the stream may already be closed.
        }
      });

      try {
        for await (const chunk of stream) {
          if (clientClosed) break;
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        if (!clientClosed) {
          res.write('data: [DONE]\n\n');
        }
      } catch (streamErr) {
        // Stream errored after headers were flushed — write a terminal error
        // frame so the client knows something went wrong, then close cleanly.
        // Do NOT call next(err): headers are already committed.
        if (!clientClosed) {
          // [V11] Map Venice API errors to structured SSE frames. Falls back to
          // generic stream_error for unknown errors.
          const handled = mapVeniceErrorToSse(streamErr, (data) => res.write(data), userId);
          if (!handled) {
            res.write(`data: ${JSON.stringify({ error: 'stream_error', code: 'stream_error' })}\n\n`);
            res.write('data: [DONE]\n\n');
          }
        }
      } finally {
        res.end();
      }
    } catch (err) {
      // [V11] Map Venice API errors before the SSE headers are flushed.
      if (mapVeniceError(err, res, userId)) return;
      next(err);
    }
  });

  return router;
}
