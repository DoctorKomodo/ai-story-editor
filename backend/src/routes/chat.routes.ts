// [V15] Chat persistence routes.
// [V16] Ask-AI attachment payload on chat messages.
//
// Two separate routers (option A from spec):
//   createChapterChatsRouter() — mounted at /api/chapters/:chapterId/chats
//   createChatMessagesRouter() — mounted at /api/chats/:chatId/messages
//
// Both use mergeParams: true so Express passes :chapterId / :chatId from the
// parent mount point down into the handler.

import { createHash } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { getVeniceClient } from '../lib/venice';
import { veniceModelsService } from '../services/venice.models.service';
import { buildPrompt, renderAskUserContent, type CharacterContext } from '../services/prompt.service';
import { createChatRepo } from '../repos/chat.repo';
import { createChapterRepo } from '../repos/chapter.repo';
import { createStoryRepo } from '../repos/story.repo';
import { createCharacterRepo } from '../repos/character.repo';
import { createMessageRepo } from '../repos/message.repo';
import { tipTapJsonToText } from '../services/tiptap-text';
import { mapVeniceError, mapVeniceErrorToSse } from '../lib/venice-errors';
import { badRequestFromZod } from '../lib/bad-request';

// ─── Role type ────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'assistant' | 'system';

// ─── Request body schemas ─────────────────────────────────────────────────────

const CreateChatBody = z
  .object({
    title: z.string().optional(),
  })
  .strict();

const PostMessageBody = z
  .object({
    content: z.string().min(1),
    modelId: z.string().min(1),
    // [V16] Optional attachment — selection from the current chapter.
    attachment: z
      .object({
        selectionText: z.string().min(1),
        chapterId: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

// ─── Helpers ──────────────────────────────────────────────────────────────────

// [V8] Deterministic prompt-cache key per (chatId, modelId) for the chat surface.
function chatPromptCacheKey(chatId: string, modelId: string): string {
  return createHash('sha256').update(`${chatId}:${modelId}`).digest('hex').slice(0, 32);
}

interface AiSettings {
  includeVeniceSystemPrompt?: boolean;
}

interface UserSettings {
  ai?: AiSettings;
}

function resolveIncludeVeniceSystemPrompt(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return true;
  const settings = raw as UserSettings;
  const flag = (settings as UserSettings).ai?.includeVeniceSystemPrompt;
  if (typeof flag === 'boolean') return flag;
  return true;
}

// ─── Router 1: chapter-scoped chat CRUD ──────────────────────────────────────

export function createChapterChatsRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  // POST /api/chapters/:chapterId/chats — create a chat for the chapter.
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const { chapterId } = req.params;

    const parsed = CreateChatBody.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    const body = parsed.data;

    try {
      // Ownership: chapter must exist and belong to req.user.
      const chapter = await createChapterRepo(req).findById(chapterId);
      if (!chapter) {
        res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
        return;
      }

      const chat = await createChatRepo(req).create({
        chapterId,
        title: body.title ?? null,
      });

      res.status(201).json({ chat });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/chapters/:chapterId/chats — list chats for the chapter.
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const { chapterId } = req.params;
    try {
      // Ownership: chapter must exist and belong to req.user.
      const chapter = await createChapterRepo(req).findById(chapterId);
      if (!chapter) {
        res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
        return;
      }

      const chats = await createChatRepo(req).findManyForChapter(chapterId);

      // Enrich each chat with its message count (via repo layer — ownership enforced).
      const enriched = await Promise.all(
        chats.map(async (chat) => {
          const messageCount = await createMessageRepo(req).countForChat(chat.id as string);
          return { ...chat, messageCount };
        }),
      );

      res.status(200).json({ chats: enriched });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// ─── Router 2: chat message POST with SSE streaming ──────────────────────────

export function createChatMessagesRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  // [V21] GET /api/chats/:chatId/messages — list messages in the chat (asc).
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const { chatId } = req.params;
    try {
      // Pre-check via repo to return 404 cleanly for unowned / missing chats;
      // findManyForChat would otherwise throw a generic Error → 500.
      const chat = await createChatRepo(req).findById(chatId);
      if (!chat) {
        res.status(404).json({ error: { message: 'Chat not found', code: 'not_found' } });
        return;
      }

      const rows = await createMessageRepo(req).findManyForChat(chatId);
      const messages = rows.map((m) => ({
        id: m.id,
        role: m.role,
        contentJson: m.contentJson,
        attachmentJson: m.attachmentJson ?? null,
        model: m.model ?? null,
        tokens: m.tokens ?? null,
        latencyMs: m.latencyMs ?? null,
        createdAt: m.createdAt,
      }));
      res.status(200).json({ messages });
    } catch (err) {
      next(err);
    }
  });

  // TODO: add per-chat rate limiting in a future task (chat rate limit follow-up).

  // POST /api/chats/:chatId/messages — append a user message, stream assistant reply.
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const { chatId } = req.params;
    const userId = req.user!.id;

    const parsed = PostMessageBody.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    const body = parsed.data;

    try {
      // ── 1. Load chat (ownership via chapter→story→user) ──────────────────
      const chat = await createChatRepo(req).findById(chatId);
      if (!chat) {
        res.status(404).json({ error: { message: 'Chat not found', code: 'not_found' } });
        return;
      }
      const chatChapterId = chat.chapterId as string;

      // ── [V16] Attachment chapter mismatch guard ───────────────────────────
      if (body.attachment && body.attachment.chapterId !== chatChapterId) {
        res.status(400).json({
          error: {
            message: 'Attachment chapterId does not match the chat\'s chapter',
            code: 'attachment_chapter_mismatch',
          },
        });
        return;
      }

      // ── 2. Prime models cache (throws NoVeniceKeyError if no BYOK) ────────
      await veniceModelsService.fetchModels(userId);
      const modelContextLength = veniceModelsService.getModelContextLength(body.modelId);

      // ── 3. Load user settings ─────────────────────────────────────────────
      const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: { settingsJson: true },
      });
      const includeVeniceSystemPrompt = resolveIncludeVeniceSystemPrompt(
        userRow?.settingsJson ?? null,
      );

      // ── 4. Load chapter + story via repos ─────────────────────────────────
      const chapter = await createChapterRepo(req).findById(chatChapterId);
      if (!chapter) {
        res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
        return;
      }
      const storyId = chapter.storyId as string;

      const story = await createStoryRepo(req).findById(storyId);
      if (!story) {
        res.status(404).json({ error: { message: 'Story not found', code: 'not_found' } });
        return;
      }

      // ── 5. Load characters ────────────────────────────────────────────────
      const rawCharacters = await createCharacterRepo(req).findManyForStory(storyId);
      const characters: CharacterContext[] = rawCharacters.map((c) => {
        const nameVal = typeof c.name === 'string' ? c.name : '';
        const roleVal = typeof c.role === 'string' ? c.role : null;
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

      // ── 6. Build prompt from chapter + story context ──────────────────────
      const chapterContent = tipTapJsonToText(chapter.body ?? null);
      const worldNotes = typeof story.worldNotes === 'string' ? story.worldNotes : null;
      const storySystemPrompt = typeof story.systemPrompt === 'string' ? story.systemPrompt : null;

      const { messages: baseMessages, venice_parameters: baseVeniceParams, max_completion_tokens } = buildPrompt({
        action: 'ask',
        selectedText: body.attachment?.selectionText ?? '',
        chapterContent,
        characters,
        worldNotes,
        modelContextLength,
        includeVeniceSystemPrompt,
        storySystemPrompt,
        freeformInstruction: body.content,
      });

      // ── 7. Load + prepend message history ────────────────────────────────
      const priorMessages = await createMessageRepo(req).findManyForChat(chatId);
      const systemMsg = baseMessages[0];
      const synthesisedUserMsg = baseMessages[1];
      const history = priorMessages.map((m) => {
        const rawContent =
          typeof m.contentJson === 'string' ? m.contentJson : JSON.stringify(m.contentJson);

        // For prior user turns that carried an attachment, re-synthesise the
        // same framing that the prompt builder emits for the `ask` action so
        // that Venice sees consistent context across turns.
        if (m.role === 'user' && m.attachmentJson != null) {
          const att = m.attachmentJson as { selectionText?: string; chapterId?: string };
          if (typeof att.selectionText === 'string') {
            return {
              role: 'user' as const,
              content: renderAskUserContent({
                freeformInstruction: rawContent,
                selectionText: att.selectionText,
              }),
            };
          }
        }

        return {
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: rawContent,
        };
      });
      const messages: Array<{ role: MessageRole; content: string }> = [
        systemMsg,
        ...history,
        synthesisedUserMsg,
      ];

      // ── 8. Persist the user message BEFORE calling Venice ────────────────
      const messageRepo = createMessageRepo(req);
      await messageRepo.create({
        chatId,
        role: 'user' as MessageRole,
        contentJson: body.content,
        attachmentJson: body.attachment ?? null,
        model: null,
        tokens: null,
        latencyMs: null,
      });

      // ── 9. Get Venice client + enrich params ──────────────────────────────
      const client = await getVeniceClient(userId);

      const venice_parameters: Record<string, unknown> = { ...baseVeniceParams };

      // [V6] Reasoning model: strip chain-of-thought tokens
      const modelInfo = veniceModelsService.findModel(body.modelId);
      if (modelInfo?.supportsReasoning === true) {
        venice_parameters.strip_thinking_response = true;
      }

      // ── 10. Call Venice with streaming ────────────────────────────────────
      // [V8/V23] `prompt_cache_key` is a Venice top-level field (sibling of
      // `model` / `messages` / `stream`), NOT nested under `venice_parameters`.
      // Scoped to (chatId, modelId) for the chat surface.
      const startedAt = Date.now();

      const streamWithResp = await (
        client.chat.completions.create({
          model: body.modelId,
          messages,
          stream: true as const,
          max_completion_tokens,
          // Request usage in the final chunk so we can persist token counts.
          stream_options: { include_usage: true },
          prompt_cache_key: chatPromptCacheKey(chatId, body.modelId),
          venice_parameters,
        } as unknown as Parameters<typeof client.chat.completions.create>[0])
      ).withResponse() as unknown as {
        data: AsyncIterable<{
          choices: Array<{ delta: { content?: string | null }; finish_reason: string | null }>;
          usage?: { total_tokens?: number } | null;
        }>;
        response: { headers: { get(name: string): string | null } };
      };
      const { data: stream, response: veniceResponse } = streamWithResp;

      // ── 11. Write SSE response headers ────────────────────────────────────
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      // [V9][V28] Forward Venice rate-limit headers. Limit/reset alongside
      // remaining lets the frontend compute "X / Y remaining until HH:MM"
      // without a second round-trip.
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

      // Headers committed — all errors from here must be written as SSE frames.

      let clientClosed = false;
      req.on('close', () => {
        clientClosed = true;
        try {
          (stream as unknown as { controller?: { abort?: () => void } }).controller?.abort?.();
        } catch {
          // ignore
        }
      });

      // ── 12. Stream chunks, accumulate content + usage ─────────────────────
      let accumulatedContent = '';
      let capturedTotalTokens: number | null = null;

      try {
        for await (const chunk of stream) {
          if (clientClosed) break;

          // Accumulate assistant content.
          const deltaContent = chunk.choices[0]?.delta?.content;
          if (typeof deltaContent === 'string') {
            accumulatedContent += deltaContent;
          }

          // Capture usage from the final chunk when stream_options.include_usage is set.
          if (chunk.usage?.total_tokens != null) {
            capturedTotalTokens = chunk.usage.total_tokens;
          }

          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        // ── 13. Persist assistant message before [DONE] ───────────────────
        if (!clientClosed) {
          const latencyMs = Date.now() - startedAt;
          try {
            await messageRepo.create({
              chatId,
              role: 'assistant' as MessageRole,
              contentJson: accumulatedContent,
              model: body.modelId,
              tokens: capturedTotalTokens,
              latencyMs,
            });
          } catch (persistErr) {
            // DB error after stream completes — log server-side, still send [DONE].
            console.error('[V15] Failed to persist assistant message', persistErr);
          }
          res.write('data: [DONE]\n\n');
        }
      } catch (streamErr) {
        // Stream errored after headers flushed — write terminal SSE error frame.
        if (!clientClosed) {
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
      // Pre-stream error — map Venice errors to JSON, let global handler deal with others.
      if (mapVeniceError(err, res, userId)) return;
      next(err);
    }
  });

  return router;
}
