import { createHash } from 'node:crypto';
import { type NextFunction, type Request, type Response, Router } from 'express';
import { type CharacterPromptInput, toCharacterPromptInput } from 'story-editor-shared';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { getVeniceClient } from '../lib/venice';
import { mapVeniceError, mapVeniceErrorToSse } from '../lib/venice-errors';
import { requireAuth } from '../middleware/auth.middleware';
import { createChapterRepo } from '../repos/chapter.repo';
import { createCharacterRepo } from '../repos/character.repo';
import { createStoryRepo } from '../repos/story.repo';
import { buildPrompt } from '../services/prompt.service';
import { tipTapJsonToText } from '../services/tiptap-text';
import {
  resolveIncludeVeniceSystemPrompt,
  resolveTextGenParams,
  resolveUserPrompts,
} from '../services/user-settings-resolvers';
import { veniceModelsService } from '../services/venice.models.service';
import type { UserSettings } from './user-settings.routes';

// ─── Request body schema ──────────────────────────────────────────────────────

const CompleteBody = z.object({
  // 'ask' is intentionally excluded: it routes into chat (V16), not /complete.
  // 'rewrite' and 'describe' are V14 additions for the selection-bubble surface.
  action: z.enum(['continue', 'rephrase', 'expand', 'summarise', 'rewrite', 'describe']),
  selectedText: z.string(),
  chapterId: z.string().min(1),
  storyId: z.string().min(1),
  modelId: z.string().min(1),
  enableWebSearch: z.boolean().optional(),
});

// ─── Prompt-cache key helper ──────────────────────────────────────────────────

// [V8] Deterministic per (storyId, modelId). Hash is sha256 hex, truncated to
// 32 chars so it stays readable in Venice's telemetry without leaking content.
function promptCacheKey(storyId: string, modelId: string): string {
  return createHash('sha256').update(`${storyId}:${modelId}`).digest('hex').slice(0, 32);
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
      console.error('[ai.models]', err);
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
      res.status(400).json({
        error: {
          message: 'Invalid request',
          code: 'invalid_request',
          details: parsed.error.flatten(),
        },
      });
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
      const rawSettings = userRow?.settingsJson ?? null;
      const includeVeniceSystemPrompt = resolveIncludeVeniceSystemPrompt(rawSettings);
      const userPrompts = resolveUserPrompts(rawSettings);
      const modelMaxCompletionTokens = veniceModelsService.getModelMaxCompletionTokens(
        body.modelId,
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

      // ── 7. Map characters to CharacterPromptInput ────────────────────────
      // Cast: findManyForStory returns Record<string, unknown>[] because projectDecrypted
      // type-erases the row. Safe at runtime: the repo invariant guarantees fully-decrypted
      // character rows, and toCharacterPromptInput narrows to the 9 prompt fields itself.
      const characters = (rawCharacters as unknown as CharacterPromptInput[]).map(
        toCharacterPromptInput,
      );

      // ── 8. Extract chapter plaintext from decrypted TipTap body ──────────
      const chapterContent = tipTapJsonToText(chapter.bodyJson ?? null);

      // ── 9. Build prompt ───────────────────────────────────────────────────
      const worldNotes = typeof story.worldNotes === 'string' ? story.worldNotes : null;

      const {
        messages,
        venice_parameters: baseVeniceParams,
        max_completion_tokens,
      } = buildPrompt({
        action: body.action,
        selectedText: body.selectedText,
        chapterContent,
        characters,
        worldNotes,
        modelContextLength,
        modelMaxCompletionTokens,
        // Pass POSITIVE_INFINITY so the prompt builder uses the model's own cap
        // for context-budget calculations. The resolved per-user max_completion_tokens
        // (from resolveTextGenParams below) is what actually goes to Venice.
        userMaxCompletionTokens: Number.POSITIVE_INFINITY,
        includeVeniceSystemPrompt,
        userPrompts,
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

      // ── 10b. Resolve text-gen parameters (X28) ────────────────────────────
      // Walks the chain: user per-model override → Venice model default →
      // global default. `modelInfo` may be null if Venice hasn't listed the
      // model yet (after cache reset); fall back to omitting temperature/top_p
      // and using buildPrompt's max_completion_tokens so the call still completes.
      // `rawSettings` is typed `unknown` from Prisma; coerce safely — the
      // resolver already guards every field with typeof checks.
      const partialSettings = (rawSettings as Partial<UserSettings>) ?? {};
      const userSettingsForResolve: UserSettings = {
        ...partialSettings,
        chat: {
          model: null,
          overrides: {},
          ...partialSettings.chat,
        },
      };
      const resolvedParams: {
        temperature: number | undefined;
        top_p: number | undefined;
        max_completion_tokens: number;
        source: { temperature: string; top_p: string; max_completion_tokens: string };
      } = modelInfo
        ? resolveTextGenParams(userSettingsForResolve, modelInfo)
        : {
            temperature: undefined,
            top_p: undefined,
            max_completion_tokens,
            source: {
              temperature: 'global-default',
              top_p: 'global-default',
              max_completion_tokens: 'global-default',
            },
          };

      if (process.env.NODE_ENV !== 'production') {
        console.log(
          '[venice.params]',
          JSON.stringify({
            route: 'ai-complete',
            userId,
            modelId: body.modelId,
            temperature: {
              value: resolvedParams.temperature,
              source: resolvedParams.source.temperature,
            },
            top_p: { value: resolvedParams.top_p, source: resolvedParams.source.top_p },
            max_completion_tokens: {
              value: resolvedParams.max_completion_tokens,
              source: resolvedParams.source.max_completion_tokens,
            },
          }),
        );
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
      const streamWithResp = (await client.chat.completions
        .create({
          model: body.modelId,
          messages,
          stream: true as const,
          temperature: resolvedParams.temperature,
          top_p: resolvedParams.top_p,
          max_completion_tokens: resolvedParams.max_completion_tokens,
          prompt_cache_key: promptCacheKey(body.storyId, body.modelId),
          venice_parameters,
        } as unknown as Parameters<typeof client.chat.completions.create>[0])
        .withResponse()) as unknown as {
        data: AsyncIterable<{
          choices: Array<{ delta: { content?: string }; finish_reason: string | null }>;
        }>;
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

      // [V9][V28] Forward Venice rate-limit headers to the client so the
      // frontend can display "X / Y remaining until HH:MM" without a second
      // round-trip. Only set each when Venice actually sent it.
      const remainingRequests = veniceResponse.headers.get('x-ratelimit-remaining-requests');
      const remainingTokens = veniceResponse.headers.get('x-ratelimit-remaining-tokens');
      const limitRequests = veniceResponse.headers.get('x-ratelimit-limit-requests');
      const limitTokens = veniceResponse.headers.get('x-ratelimit-limit-tokens');
      const resetRequests = veniceResponse.headers.get('x-ratelimit-reset-requests');
      const resetTokens = veniceResponse.headers.get('x-ratelimit-reset-tokens');
      if (remainingRequests !== null) {
        res.setHeader('x-venice-remaining-requests', remainingRequests);
      }
      if (remainingTokens !== null) {
        res.setHeader('x-venice-remaining-tokens', remainingTokens);
      }
      if (limitRequests !== null) {
        res.setHeader('x-venice-limit-requests', limitRequests);
      }
      if (limitTokens !== null) {
        res.setHeader('x-venice-limit-tokens', limitTokens);
      }
      if (resetRequests !== null) {
        res.setHeader('x-venice-reset-requests', resetRequests);
      }
      if (resetTokens !== null) {
        res.setHeader('x-venice-reset-tokens', resetTokens);
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
        console.error('[ai.complete:stream]', streamErr);
        if (!clientClosed) {
          // [V11] Map Venice API errors to structured SSE frames. Falls back to
          // generic stream_error for unknown errors.
          const handled = mapVeniceErrorToSse(streamErr, (data) => res.write(data), userId);
          if (!handled) {
            res.write(
              `data: ${JSON.stringify({
                error: 'An internal stream error occurred.',
                code: 'stream_error',
                message: 'An internal stream error occurred.',
              })}\n\n`,
            );
            res.write('data: [DONE]\n\n');
          }
        }
      } finally {
        res.end();
      }
    } catch (err) {
      // [V11] Map Venice API errors before the SSE headers are flushed.
      console.error('[ai.complete]', err);
      if (mapVeniceError(err, res, userId)) return;
      next(err);
    }
  });

  return router;
}
