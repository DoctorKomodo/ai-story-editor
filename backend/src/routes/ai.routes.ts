import { type NextFunction, type Request, type Response, Router } from 'express';
import { toCharacterPromptInput } from 'story-editor-shared';
import { z } from 'zod';
import {
  logVeniceErrorDev,
  mapVeniceError,
  mapVeniceErrorToSse,
  type VeniceRequestSnapshot,
} from '../lib/venice-errors';
import { requireAuth } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate';
import { createChapterRepo } from '../repos/chapter.repo';
import { createCharacterRepo } from '../repos/character.repo';
import { createStoryRepo } from '../repos/story.repo';
import { getDekFromRequest } from '../services/content-crypto.service';
import { buildPrompt } from '../services/prompt.service';
import { tipTapJsonToText } from '../services/tiptap-text';
import { veniceModelsService } from '../services/venice.models.service';
import {
  buildVeniceParams,
  hydrateUserSettings,
  logVeniceParams,
  promptCacheKey,
  resolveReasoningEnabled,
  resolveTextGenWithFallback,
} from '../services/venice-call.service';
import { veniceKeyService } from '../services/venice-key.service';

// ─── Request body schema ──────────────────────────────────────────────────────

const CompleteBody = z.object({
  // 'ask' is intentionally excluded: it routes into chat (V16), not /complete.
  // 'rewrite' and 'describe' are V14 additions for the selection-bubble surface.
  action: z.enum(['continue', 'rephrase', 'expand', 'summarise', 'rewrite', 'describe']),
  selectedText: z.string(),
  chapterId: z.string().min(1),
  storyId: z.string().min(1),
  modelId: z.string().min(1),
  // [X11] Web search is intentionally NOT accepted on the inline /complete
  // surface: citations are rendered only in the chat panel (V26), so enabling
  // web search here would incur Venice cost with no user-visible benefit
  // (citations dropped silently). Web search stays opt-in on chat only. See
  // docs/venice-integration.md § Web Search.
});

export function createAiRouter() {
  const router = Router();

  router.use(requireAuth);

  // [V1] GET /api/ai/models — list text models the caller's BYOK key can see,
  // returned as the full `ModelInfo` shape (no projection; see venice.models.service.ts).
  // Cached in-memory for 10 minutes by the models service. A missing key
  // surfaces as NoVeniceKeyError from veniceKeyService.getClient, which the global error
  // handler maps to 409 { error: "venice_key_required" }.
  router.get('/models', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const models = await veniceModelsService.fetchModels(getDekFromRequest(req), req.user!.id);
      res.status(200).json({ models });
    } catch (err) {
      if (mapVeniceError(err, res, { userId: req.user!.id, route: 'ai-models' })) return;
      next(err);
    }
  });

  // [V5] POST /api/ai/complete — streams AI completions back as SSE.
  // [V6] reasoning flag — strip_thinking_response for supportsReasoning models.
  // [V7] web-search flag — chat-only; intentionally not wired on /complete ([X11]).
  // [V8] prompt-cache key — sha256(storyId:modelId) truncated to 32 hex chars.
  router.post(
    '/complete',
    validateBody(CompleteBody, async (body, req, res) => {
      const userId = req.user!.id;
      let snapshot: VeniceRequestSnapshot | undefined;

      try {
        // ── 2. Prime models cache + get context length ───────────────────────
        // fetchModels throws NoVeniceKeyError when user has no BYOK key → 409.
        // Called before any DB reads so a missing BYOK key surfaces immediately
        // without leaking whether the story/chapter exists (per spec: step 6
        // runs "first"). Also throws UnknownModelError when modelId isn't in
        // Venice's list → propagates as 500 (V11 will refine later).
        await veniceModelsService.fetchModels(getDekFromRequest(req), userId);
        const modelContextLength = veniceModelsService.getModelContextLength(body.modelId, userId);

        // ── 3. Load user settings (not a narrative entity — direct prisma ok) ──
        const { settings, includeVeniceSystemPrompt, userPrompts } =
          await hydrateUserSettings(userId);
        const modelMaxCompletionTokens = veniceModelsService.getModelMaxCompletionTokens(
          body.modelId,
          userId,
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

        // ── 6b. Previous-chapter summaries (toggle-gated) ────────────────────
        const previousChapters = story.includePreviousChaptersInPrompt
          ? (await createChapterRepo(req).findManyForStory(body.storyId, { includeSummary: true }))
              .filter(
                (c): c is typeof c & { summary: NonNullable<(typeof c)['summary']> } =>
                  c.orderIndex < chapter.orderIndex && c.summary !== null,
              )
              .map((c) => ({ orderIndex: c.orderIndex, title: c.title, summary: c.summary }))
          : undefined;

        // ── 7. Map characters to CharacterPromptInput ────────────────────────
        const characters = rawCharacters.map(toCharacterPromptInput);

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
          previousChapters,
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
        const modelInfo = veniceModelsService.findModel(body.modelId, userId);
        const venice_parameters = buildVeniceParams({
          base: baseVeniceParams,
          supportsReasoning: modelInfo?.supportsReasoning === true,
        });
        const reasoningEnabled = resolveReasoningEnabled(settings, modelInfo);

        // ── 10b. Resolve text-gen parameters (X28) ────────────────────────────
        const resolved = resolveTextGenWithFallback(settings, modelInfo, max_completion_tokens);

        logVeniceParams({
          route: 'ai-complete',
          userId,
          modelId: body.modelId,
          resolved,
          action: body.action,
          modelCap: modelMaxCompletionTokens,
          reasoningEnabled,
        });

        // ── 11. Get the Venice client ─────────────────────────────────────────
        const client = await veniceKeyService.getClient(getDekFromRequest(req), userId);

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
        const cacheKey = promptCacheKey(body.storyId, body.modelId);

        snapshot = {
          model: body.modelId,
          messageCount: messages.length,
          systemMessagePreview:
            typeof messages[0]?.content === 'string' ? messages[0].content : undefined,
          userMessagePreview:
            typeof messages.at(-1)?.content === 'string'
              ? (messages.at(-1)!.content as string)
              : undefined,
          venice_parameters,
          promptCacheKey: cacheKey,
          temperature: resolved.temperature,
          top_p: resolved.top_p,
          max_completion_tokens: resolved.max_completion_tokens,
        };

        const streamWithResp = (await client.chat.completions
          .create({
            model: body.modelId,
            messages,
            stream: true as const,
            temperature: resolved.temperature,
            top_p: resolved.top_p,
            max_completion_tokens: resolved.max_completion_tokens,
            prompt_cache_key: cacheKey,
            venice_parameters,
            ...(reasoningEnabled ? {} : { reasoning: { enabled: false } }),
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
          logVeniceErrorDev({
            err: streamErr,
            ctx: { userId, route: 'ai-complete' },
            request: snapshot,
          });
          if (!clientClosed) {
            // [V11] Map Venice API errors to structured SSE frames. Falls back to
            // generic stream_error for unknown errors.
            const handled = mapVeniceErrorToSse(streamErr, (data) => res.write(data), {
              userId,
              route: 'ai-complete',
            });
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
        logVeniceErrorDev({ err, ctx: { userId, route: 'ai-complete' }, request: snapshot });
        if (mapVeniceError(err, res, { userId, route: 'ai-complete' })) return;
        throw err;
      }
    }),
  );

  return router;
}
