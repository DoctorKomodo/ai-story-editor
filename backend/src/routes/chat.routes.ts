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
import { type NextFunction, type Request, type Response, Router } from 'express';
import type { Citation } from 'story-editor-shared';
import { toCharacterPromptInput } from 'story-editor-shared';
import { z } from 'zod';
import { badRequestFromZod } from '../lib/bad-request';
import { prisma } from '../lib/prisma';
import { getVeniceClient } from '../lib/venice';
import { projectVeniceCitations } from '../lib/venice-citations';
import { mapVeniceError, mapVeniceErrorToSse } from '../lib/venice-errors';
import { requireAuth } from '../middleware/auth.middleware';
import { createChapterRepo } from '../repos/chapter.repo';
import { createCharacterRepo } from '../repos/character.repo';
import { createChatRepo } from '../repos/chat.repo';
import { createMessageRepo } from '../repos/message.repo';
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

// ─── Role type ────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'assistant' | 'system';

// ─── Request body schemas ─────────────────────────────────────────────────────

const ChatKind = z.enum(['ask', 'scene']);

const CreateChatBody = z
  .object({
    title: z.string().optional(),
    kind: ChatKind.optional(),
  })
  .strict();

const ListChatsQuery = z
  .object({
    kind: ChatKind.optional(),
  })
  .strict();

const PostMessageBody = z
  .object({
    content: z.string().min(1).optional(),
    modelId: z.string().min(1),
    // [SC6] When retry=true the handler replays the existing trailing user
    // turn against a fresh Venice completion without persisting a new user
    // message. `content` is not required in this case.
    retry: z.boolean().optional(),
    // [V16] Optional attachment — selection from the current chapter.
    attachment: z
      .object({
        selectionText: z.string().min(1),
        chapterId: z.string().min(1),
      })
      .strict()
      .optional(),
    // [V26] Opt-in web search for this chat turn. When true, the handler
    // enables Venice web search + citations + in-stream delivery; when
    // false/omitted, the stream behaves exactly as today.
    enableWebSearch: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (!body.retry && !body.content) {
      ctx.addIssue({
        code: 'custom',
        message: 'content is required unless retry is true',
        path: ['content'],
      });
    }
    if (body.retry && body.content !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'content must be omitted when retry is true',
        path: ['content'],
      });
    }
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────

// [V8] Deterministic prompt-cache key per (chatId, modelId) for the chat surface.
function chatPromptCacheKey(chatId: string, modelId: string): string {
  return createHash('sha256').update(`${chatId}:${modelId}`).digest('hex').slice(0, 32);
}

// ─── Router 1: chapter-scoped chat CRUD ──────────────────────────────────────

export function createChapterChatsRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  // POST /api/chapters/:chapterId/chats — create a chat for the chapter.
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const chapterId = req.params.chapterId as string;

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
        kind: body.kind ?? 'ask',
      });

      res.status(201).json({ chat });
    } catch (err) {
      console.error('[chat.create]', err);
      next(err);
    }
  });

  // GET /api/chapters/:chapterId/chats — list chats for the chapter.
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const chapterId = req.params.chapterId as string;

    const parsedQuery = ListChatsQuery.safeParse(req.query);
    if (!parsedQuery.success) {
      badRequestFromZod(res, parsedQuery.error);
      return;
    }
    const { kind } = parsedQuery.data;

    try {
      // Ownership: chapter must exist and belong to req.user.
      const chapter = await createChapterRepo(req).findById(chapterId);
      if (!chapter) {
        res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
        return;
      }

      const chats = await createChatRepo(req).findManyForChapter(chapterId, { kind });

      // Enrich each chat with its message count (via repo layer — ownership enforced).
      const enriched = await Promise.all(
        chats.map(async (chat) => {
          const messageCount = await createMessageRepo(req).countForChat(chat.id as string);
          return { ...chat, messageCount };
        }),
      );

      res.status(200).json({ chats: enriched });
    } catch (err) {
      console.error('[chat.list]', err);
      next(err);
    }
  });

  return router;
}

// ─── Router 3: chat-level CRUD (rename, etc.) ────────────────────────────────

const PatchChatBody = z
  .object({
    title: z.string().min(1).max(200),
  })
  .strict();

export function createChatCrudRouter() {
  const router = Router();
  router.use(requireAuth);

  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id as string;
    const parsed = PatchChatBody.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }
    try {
      const repo = createChatRepo(req);
      // findById enforces ownership via the repo's chapter→story→user chain;
      // null = not found OR not owned (intentionally indistinguishable).
      const existing = await repo.findById(id);
      if (!existing) {
        res.status(404).json({ error: { message: 'Chat not found', code: 'not_found' } });
        return;
      }
      const updated = await repo.update(id, { title: parsed.data.title });
      // Belt-and-suspenders: row deleted between the ownership-check findById and
      // the update (TOCTOU). Treated identically to "not found".
      if (!updated) {
        res.status(404).json({ error: { message: 'Chat not found', code: 'not_found' } });
        return;
      }
      res.status(200).json({ chat: updated });
    } catch (err) {
      console.error('[chat.patch]', err);
      next(err);
    }
  });

  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id as string;
    try {
      const repo = createChatRepo(req);
      const existing = await repo.findById(id);
      if (!existing) {
        res.status(404).json({ error: { message: 'Chat not found', code: 'not_found' } });
        return;
      }
      const ok = await repo.remove(id);
      if (!ok) {
        res.status(404).json({ error: { message: 'Chat not found', code: 'not_found' } });
        return;
      }
      res.status(204).send();
    } catch (err) {
      console.error('[chat.delete]', err);
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
    const chatId = req.params.chatId as string;
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
        content: m.content,
        attachmentJson: m.attachmentJson ?? null,
        // [V26] `citationsJson` is `Citation[] | null` — null when the turn
        // had no web search or produced no valid results (see §6 of the spec).
        citationsJson: m.citationsJson ?? null,
        model: m.model ?? null,
        tokens: m.tokens ?? null,
        latencyMs: m.latencyMs ?? null,
        createdAt: m.createdAt,
      }));
      res.status(200).json({ messages });
    } catch (err) {
      console.error('[chat.messages.list]', err);
      next(err);
    }
  });

  // TODO: add per-chat rate limiting in a future task (chat rate limit follow-up).

  // POST /api/chats/:chatId/messages — append a user message, stream assistant reply.
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const chatId = req.params.chatId as string;
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
            message: "Attachment chapterId does not match the chat's chapter",
            code: 'attachment_chapter_mismatch',
          },
        });
        return;
      }

      // ── 1b. Load message history early for retry validation ──────────────
      // Done here — before any external calls — so an invalid retry state
      // returns 400 without touching the Venice API or user settings.
      // messageRepo is hoisted here so it can also be used for deleteAllAfter
      // in the retry branch below (step 1c) and for persisting the user/assistant
      // messages later (step 9a / stream handler).
      const messageRepo = createMessageRepo(req);
      const priorMessages = await messageRepo.findManyForChat(chatId);

      // ── [SC6] Retry validation ────────────────────────────────────────────
      // Compute lastUserMsg once; reused below for trailingUserContent.
      // Retry replays the last user turn; there must be at least one user
      // message in the history (regardless of what the trailing message is).
      const lastUserMsg = priorMessages.findLast((m) => m.role === 'user');
      if (body.retry && !lastUserMsg) {
        res.status(400).json({
          error: {
            message: 'Cannot retry: no user message exists in this chat.',
            code: 'retry_invalid_state',
          },
        });
        return;
      }

      // ── 1c. [ai-surfaces-v1] On retry, delete trailing-after-lastUser rows ─
      // Delete any rows that came after the last user turn (typically a prior
      // assistant turn this retry is replacing), then re-fetch so history is
      // correct. On a normal turn this block is skipped entirely.
      let priorMessagesForHistory = priorMessages;
      if (body.retry && lastUserMsg) {
        await messageRepo.deleteAllAfter(chatId, lastUserMsg.id as string);
        priorMessagesForHistory = await messageRepo.findManyForChat(chatId);
      }

      // ── 2. Prime models cache (throws NoVeniceKeyError if no BYOK) ────────
      await veniceModelsService.fetchModels(userId);
      const modelContextLength = veniceModelsService.getModelContextLength(body.modelId);

      // ── 3. Load user settings ─────────────────────────────────────────────
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
      const characters = rawCharacters.map(toCharacterPromptInput);

      // ── 6. Build prompt from chapter + story context ──────────────────────
      const chapterContent = tipTapJsonToText(chapter.bodyJson ?? null);
      const worldNotes = typeof story.worldNotes === 'string' ? story.worldNotes : null;

      // Route by chat.kind: scene chats use the scene action (raw direction as
      // user message, scene template in system); ask chats use the ask action.
      const action: 'ask' | 'scene' = chat.kind === 'scene' ? 'scene' : 'ask';

      // [SC6] On retry, use the last user turn's content as the user
      // instruction (passed via freeformInstruction, which the ask/scene
      // builder arms read) so the prompt builder assembles the system
      // message correctly. On a normal turn, use body.content (guaranteed
      // non-empty by superRefine when retry is false/omitted).
      // lastUserMsg is guaranteed non-null here for retry (checked above).
      const trailingUserContent: string = body.retry
        ? lastUserMsg!.content
        : (body.content as string);

      const {
        messages: baseMessages,
        venice_parameters: baseVeniceParams,
        max_completion_tokens,
      } = buildPrompt({
        action,
        selectedText: body.attachment?.selectionText ?? '',
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
        freeformInstruction: trailingUserContent,
      });

      // ── 8. Build messages array for Venice ───────────────────────────────
      const systemMsg = baseMessages[0];
      const synthesisedUserMsg = baseMessages[1];
      // [k1r] Uniform per-action history mapping. Any prior user turn (any
      // chat kind) that carried an attachmentJson.selectionText gets the
      // same `\n\nAttached selection: «...»` suffix the current-turn user
      // payload uses (see buildUserPayload). No `User question:` prefix
      // anywhere — the role label is the provenance signal. This is the
      // change flagged in
      // docs/superpowers/specs/2026-05-10-k1r-prompt-building-unification-design.md
      // §chat.routes.ts simplifications (a).
      const history = priorMessagesForHistory.map((m) => {
        const rawContent = m.content;

        if (m.role === 'user' && m.attachmentJson != null) {
          const att = m.attachmentJson as { selectionText?: string; chapterId?: string };
          if (typeof att.selectionText === 'string' && att.selectionText.length > 0) {
            return {
              role: 'user' as const,
              content: `${rawContent}\n\nAttached selection: «${att.selectionText}»`,
            };
          }
        }

        return {
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: rawContent,
        };
      });
      // [k1r] On retry the trailing history entry equals what
      // buildUserPayload would emit for the same inputs (both are built from
      // lastUserMsg.contentJson + lastUserMsg.attachmentJson under the
      // unified history mapping). So the retry path uses [systemMsg, ...history]
      // and the trailing entry IS the user message — chapter / characters /
      // world-notes context lives in systemMsg in both branches, so the
      // 9ph context-loss bug is structurally impossible.
      const messages: Array<{ role: MessageRole; content: string }> = body.retry
        ? [systemMsg, ...history]
        : [systemMsg, ...history, synthesisedUserMsg];

      // ── 9a. Persist the user message BEFORE calling Venice (normal turn only)
      if (!body.retry) {
        await messageRepo.create({
          chatId,
          role: 'user' as MessageRole,
          content: body.content as string,
          attachmentJson: body.attachment ?? null,
          model: null,
          tokens: null,
          latencyMs: null,
        });
      }

      // ── 9b. Get Venice client + enrich params ─────────────────────────────
      const client = await getVeniceClient(userId);

      const venice_parameters: Record<string, unknown> = { ...baseVeniceParams };

      // [V6] Reasoning model: strip chain-of-thought tokens
      const modelInfo = veniceModelsService.findModel(body.modelId);
      if (modelInfo?.supportsReasoning === true) {
        venice_parameters.strip_thinking_response = true;
      }

      // [V26] Opt-in Venice web search for this chat turn. Sets the three
      // Venice params that together cause (1) search to run, (2) citations
      // to survive rather than get inlined as plain text, and (3) results
      // to arrive in-band as a non-standard first chunk on the SSE stream.
      // When `enableWebSearch` is false/omitted, none of these are set.
      if (body.enableWebSearch === true) {
        venice_parameters.enable_web_search = 'auto';
        venice_parameters.enable_web_citations = true;
        venice_parameters.include_search_results_in_stream = true;
      }

      // ── 9b. Resolve text-gen parameters (X28) ────────────────────────────
      // Walks the chain: user per-model override → Venice model default →
      // global default. `modelInfo` may be null if Venice hasn't listed the
      // model yet (after cache reset); fall back to omitting temperature/top_p
      // and using buildPrompt's max_completion_tokens so the call still completes.
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
            route: 'chat',
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

      // ── 10. Call Venice with streaming ────────────────────────────────────
      // [V8/V23] `prompt_cache_key` is a Venice top-level field (sibling of
      // `model` / `messages` / `stream`), NOT nested under `venice_parameters`.
      // Scoped to (chatId, modelId) for the chat surface.
      const startedAt = Date.now();

      const streamWithResp = (await client.chat.completions
        .create({
          model: body.modelId,
          messages,
          stream: true as const,
          temperature: resolvedParams.temperature,
          top_p: resolvedParams.top_p,
          max_completion_tokens: resolvedParams.max_completion_tokens,
          // Request usage in the final chunk so we can persist token counts.
          stream_options: { include_usage: true },
          prompt_cache_key: chatPromptCacheKey(chatId, body.modelId),
          venice_parameters,
        } as unknown as Parameters<typeof client.chat.completions.create>[0])
        .withResponse()) as unknown as {
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
      // [V26] Citation capture state. `citationsHandled` latches on the first
      // `venice_search_results` chunk (valid or malformed) so a later
      // duplicate chunk can't re-trigger. `capturedCitations` stays null
      // when Venice returned no valid results — that null gets persisted
      // verbatim (null ≠ [] per §6).
      let citationsHandled = false;
      let capturedCitations: Citation[] | null = null;

      try {
        for await (const chunk of stream) {
          if (clientClosed) break;

          // [V26] Venice's `include_search_results_in_stream: true` adds a
          // non-standard first chunk carrying `venice_search_results`. It is
          // not part of the OpenAI chunk shape, so we access it via cast.
          // We CONSUME this chunk (do not forward it to the client) and
          // instead emit a single `event: citations` SSE frame before any
          // content frame. Empty / malformed results → latch, emit nothing.
          if (!citationsHandled) {
            const veniceChunk = chunk as unknown as {
              venice_search_results?: unknown;
            };
            if (veniceChunk.venice_search_results !== undefined) {
              citationsHandled = true;
              const projected = projectVeniceCitations(veniceChunk.venice_search_results);
              if (projected.length > 0) {
                capturedCitations = projected;
                res.write(
                  `event: citations\ndata: ${JSON.stringify({ citations: projected })}\n\n`,
                );
              }
              // Do NOT forward this chunk — continue to the next iteration.
              continue;
            }
          }

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
              content: accumulatedContent,
              // [V26] Persist captured citations (null when none).
              citationsJson: capturedCitations,
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
        console.error('[chat.messages.send:stream]', streamErr);
        if (!clientClosed) {
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
      // Pre-stream error — map Venice errors to JSON, let global handler deal with others.
      console.error('[chat.messages.send]', err);
      if (mapVeniceError(err, res, userId)) return;
      next(err);
    }
  });

  return router;
}
