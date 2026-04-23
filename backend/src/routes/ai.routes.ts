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

// ─── Request body schema ──────────────────────────────────────────────────────

const CompleteBody = z
  .object({
    action: z.enum(['continue', 'rephrase', 'expand', 'summarise', 'freeform']),
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

      const { messages, venice_parameters: baseVeniceParams, max_tokens } = buildPrompt({
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

      // [V8] Prompt cache key — deterministic per (storyId, modelId)
      venice_parameters.prompt_cache_key = promptCacheKey(body.storyId, body.modelId);

      // ── 11. Get the Venice client ─────────────────────────────────────────
      const client = await getVeniceClient(userId);

      // ── 12. Call Venice with streaming ────────────────────────────────────
      // `venice_parameters` is not in the openai SDK types; cast at call site.
      const stream = await client.chat.completions.create({
        model: body.modelId,
        messages,
        stream: true,
        max_tokens,
        venice_parameters,
      } as unknown as Parameters<typeof client.chat.completions.create>[0]);

      // ── 13. Write SSE response ────────────────────────────────────────────
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
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
      } catch {
        // Stream errored after headers were flushed — write a terminal error
        // frame so the client knows something went wrong, then close cleanly.
        // Do NOT call next(err): headers are already committed.
        if (!clientClosed) {
          res.write(`data: ${JSON.stringify({ error: 'stream_error', code: 'stream_error' })}\n\n`);
          res.write('data: [DONE]\n\n');
        }
      } finally {
        res.end();
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}
