import { type NextFunction, type Request, type Response, Router } from 'express';
import { toCharacterPromptInput } from 'story-editor-shared';
import { z } from 'zod';
import {
  logVeniceErrorDev,
  mapVeniceError,
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
import { hydrateUserSettings } from '../services/venice-call.service';
import { veniceKeyService } from '../services/venice-key.service';
import { prepareVeniceCall, streamVeniceToResponse } from '../services/venice-stream.service';

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
        // Venice's list → 400 unknown_model via the global handler.
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

        // ── 10. Prepare the Venice request (params, model settings, cache key) ──
        const prepared = prepareVeniceCall({
          route: 'ai-complete',
          userId,
          modelId: body.modelId,
          messages,
          settings,
          baseVeniceParams,
          fallbackMaxCompletionTokens: max_completion_tokens,
          cacheKeyParts: [body.storyId, body.modelId],
          action: body.action,
          modelCap: modelMaxCompletionTokens,
        });
        snapshot = prepared.snapshot;

        // ── 11. Get the Venice client ─────────────────────────────────────────
        const client = await veniceKeyService.getClient(getDekFromRequest(req), userId);

        // ── 12-13. Call Venice with streaming + write the SSE response ─────────
        await streamVeniceToResponse({
          client,
          req,
          res,
          prepared,
          ctx: { userId, route: 'ai-complete' },
        });
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
