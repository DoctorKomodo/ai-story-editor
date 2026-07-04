// [V15] Chat persistence routes.
// [V16] Ask-AI attachment payload on chat messages.
//
// Two separate routers (option A from spec):
//   createChapterChatsRouter() — mounted at /api/chapters/:chapterId/chats
//   createChatMessagesRouter() — mounted at /api/chats/:chatId/messages
//
// Both use mergeParams: true so Express passes :chapterId / :chatId from the
// parent mount point down into the handler.

import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  type Citation,
  chatCreateSchema,
  chatKindSchema,
  chatResponseSchema,
  chatsResponseSchema,
  chatUpdateSchema,
  editMessageBodySchema,
  type MessageRole,
  messageResponseSchema,
  messagesResponseSchema,
  sendMessageBodySchema,
  toCharacterPromptInput,
} from 'story-editor-shared';
import { z } from 'zod';
import { respond } from '../lib/respond';
import { serializeChat, serializeMessage } from '../lib/serialize';
import { projectVeniceCitations } from '../lib/venice-citations';
import {
  logVeniceErrorDev,
  mapVeniceError,
  type VeniceRequestSnapshot,
} from '../lib/venice-errors';
import { requireAuth } from '../middleware/auth.middleware';
import { validateBody, validateQuery } from '../middleware/validate';
import { createChapterRepo } from '../repos/chapter.repo';
import { createCharacterRepo } from '../repos/character.repo';
import { createChatRepo } from '../repos/chat.repo';
import { createDraftRepo } from '../repos/draft.repo';
import { createMessageRepo } from '../repos/message.repo';
import { createStoryRepo } from '../repos/story.repo';
import { getDekFromRequest } from '../services/content-crypto.service';
import { buildPrompt } from '../services/prompt.service';
import { tipTapJsonToText } from '../services/tiptap-text';
import { veniceModelsService } from '../services/venice.models.service';
import { hydrateUserSettings } from '../services/venice-call.service';
import { veniceKeyService } from '../services/venice-key.service';
import { prepareVeniceCall, streamVeniceToResponse } from '../services/venice-stream.service';

// ─── Request body schemas ─────────────────────────────────────────────────────

const ListChatsQuery = z.strictObject({ kind: chatKindSchema.optional() });

// ─── Router 1: chapter-scoped chat CRUD ──────────────────────────────────────

export function createChapterChatsRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  // POST /api/chapters/:chapterId/chats — create a chat for the chapter.
  router.post(
    '/',
    validateBody(chatCreateSchema, async (body, req, res) => {
      const chapterId = req.params.chapterId as string;

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

      return respond(chatResponseSchema, res, { chat: serializeChat(chat) }, 201);
    }),
  );

  // GET /api/chapters/:chapterId/chats — list chats for the chapter.
  router.get(
    '/',
    validateQuery(ListChatsQuery, async (query, req, res) => {
      const chapterId = req.params.chapterId as string;
      const { kind } = query;

      // Ownership: chapter must exist and belong to req.user.
      const chapter = await createChapterRepo(req).findById(chapterId);
      if (!chapter) {
        res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
        return;
      }

      const chats = await createChatRepo(req).findManyForChapter(chapterId, { kind });

      // Enrich each chat with its message count (via repo layer — ownership enforced).
      const enriched = await Promise.all(
        chats.map(async (chat) => ({
          ...serializeChat(chat),
          messageCount: await createMessageRepo(req).countForChat(chat.id as string),
        })),
      );

      return respond(chatsResponseSchema, res, { chats: enriched });
    }),
  );

  return router;
}

// ─── Router 3: chat-level CRUD (rename, etc.) ────────────────────────────────

export function createChatCrudRouter() {
  const router = Router();
  router.use(requireAuth);

  router.patch(
    '/:id',
    validateBody(chatUpdateSchema, async (body, req, res) => {
      const id = req.params.id as string;
      const repo = createChatRepo(req);
      // findById enforces ownership via the repo's chapter→story→user chain;
      // null = not found OR not owned (intentionally indistinguishable).
      const existing = await repo.findById(id);
      if (!existing) {
        res.status(404).json({ error: { message: 'Chat not found', code: 'not_found' } });
        return;
      }
      const updated = await repo.update(id, { title: body.title });
      // Belt-and-suspenders: row deleted between the ownership-check findById and
      // the update (TOCTOU). Treated identically to "not found".
      if (!updated) {
        res.status(404).json({ error: { message: 'Chat not found', code: 'not_found' } });
        return;
      }
      return respond(chatResponseSchema, res, { chat: serializeChat(updated) }, 200);
    }),
  );

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
      const messages = rows.map(serializeMessage);
      return respond(messagesResponseSchema, res, { messages });
    } catch (err) {
      next(err);
    }
  });

  // TODO: add per-chat rate limiting in a future task (chat rate limit follow-up).

  // PATCH /api/chats/:chatId/messages/:id — edit a user message in place.
  router.patch(
    '/:id',
    validateBody(editMessageBodySchema, async (body, req, res) => {
      const chatId = req.params.chatId as string;
      const id = req.params.id as string;

      // Ownership pre-check on the chat (clean 404 for missing/unowned chat).
      const chat = await createChatRepo(req).findById(chatId);
      if (!chat) {
        res.status(404).json({ error: { message: 'Chat not found', code: 'not_found' } });
        return;
      }

      const updated = await createMessageRepo(req).update(id, chatId, { content: body.content });
      if (!updated) {
        // null = not found / not owned / not a user message.
        res.status(404).json({ error: { message: 'Message not editable', code: 'not_found' } });
        return;
      }
      return respond(messageResponseSchema, res, { message: serializeMessage(updated) }, 200);
    }),
  );

  // POST /api/chats/:chatId/messages — append a user message, stream assistant reply.
  router.post(
    '/',
    validateBody(sendMessageBodySchema, async (body, req, res) => {
      const chatId = req.params.chatId as string;
      const userId = req.user!.id;
      let snapshot: VeniceRequestSnapshot | undefined;

      try {
        // ── 1. Load chat (ownership via chapter→story→user) ──────────────────
        const chat = await createChatRepo(req).findById(chatId);
        if (!chat) {
          res.status(404).json({ error: { message: 'Chat not found', code: 'not_found' } });
          return;
        }
        // [9wk.3] Chats are draft-scoped; the chapter is reached through the
        // draft. draft.repo.findById is owner-filtered, and the chat itself was
        // ownership-checked above — a miss here is an invariant violation.
        const chatDraft = await createDraftRepo(req).findById(chat.draftId as string);
        if (!chatDraft) {
          throw new Error('chat.routes: chat draft not resolvable (invariant violation)');
        }
        const chatChapterId = chatDraft.chapterId;

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

        // ── 1b. Load message history early for replay validation ─────────────
        // Done here — before any external calls — so an invalid replay state
        // returns 400 without touching the Venice API or user settings.
        // messageRepo is hoisted here so it can also be used for deleteAllAfter
        // in the replay branch below (step 1c) and for persisting the user/assistant
        // messages later (step 9a / stream handler).
        const messageRepo = createMessageRepo(req);
        const priorMessages = await messageRepo.findManyForChat(chatId);

        // ── [SC6] Retry / resend validation and anchor resolution ───────────
        // retry=true  → anchor is the last user message (classic linear retry).
        // fromMessageId → anchor is that specific message, looked up from THIS
        //   chat's already-loaded list. We use priorMessages.find (chat-scoped)
        //   rather than messageRepo.findById (user-scoped only) so that a
        //   fromMessageId belonging to another of the same user's chats is
        //   correctly rejected — findById would pass ownership but deleteAllAfter
        //   (chat-scoped) would then silently drop nothing and replay foreign content.
        const lastUserMsg = priorMessages.findLast((m) => m.role === 'user');
        const isReplay = body.retry === true || body.fromMessageId !== undefined;
        const anchor = body.fromMessageId
          ? priorMessages.find((m) => m.id === body.fromMessageId)
          : lastUserMsg;

        if (body.retry === true && !lastUserMsg) {
          res.status(400).json({
            error: {
              message: 'Cannot retry: no user message exists in this chat.',
              code: 'retry_invalid_state',
            },
          });
          return;
        }
        if (body.fromMessageId !== undefined && anchor?.role !== 'user') {
          // Not found in this chat / belongs to another chat / not a user message.
          res.status(400).json({
            error: {
              message: 'Cannot resend: target is not an editable user message in this chat.',
              code: 'resend_invalid_state',
            },
          });
          return;
        }

        // ── 1c. [ai-surfaces-v1] On replay, delete trailing-after-anchor rows ─
        // Delete any rows that came after the anchor user turn (typically a prior
        // assistant turn this replay is replacing), then re-fetch so history is
        // correct. On a normal turn this block is skipped entirely.
        let priorMessagesForHistory = priorMessages;
        if (isReplay && anchor) {
          await messageRepo.deleteAllAfter(chatId, anchor.id);
          priorMessagesForHistory = await messageRepo.findManyForChat(chatId);
        }

        // ── 2. Prime models cache (throws NoVeniceKeyError if no BYOK) ────────
        await veniceModelsService.fetchModels(getDekFromRequest(req), userId);
        const modelContextLength = veniceModelsService.getModelContextLength(body.modelId, userId);

        // ── 3. Load user settings ─────────────────────────────────────────────
        const { settings, includeVeniceSystemPrompt, userPrompts } =
          await hydrateUserSettings(userId);
        const modelMaxCompletionTokens = veniceModelsService.getModelMaxCompletionTokens(
          body.modelId,
          userId,
        );

        // ── 4. Load chapter + story via repos ─────────────────────────────────
        const chapter = await createChapterRepo(req).findById(chatChapterId);
        if (!chapter) {
          res.status(404).json({ error: { message: 'Chapter not found', code: 'not_found' } });
          return;
        }
        const storyId = chapter.storyId;

        const story = await createStoryRepo(req).findById(storyId);
        if (!story) {
          res.status(404).json({ error: { message: 'Story not found', code: 'not_found' } });
          return;
        }

        // ── 5. Load characters ────────────────────────────────────────────────
        const rawCharacters = await createCharacterRepo(req).findManyForStory(storyId);
        const characters = rawCharacters.map(toCharacterPromptInput);

        // ── 5b. Previous-chapter summaries (toggle-gated) ────────────────────
        const previousChapters = story.includePreviousChaptersInPrompt
          ? (await createChapterRepo(req).findManyForStory(storyId, { includeSummary: true }))
              .filter(
                (c): c is typeof c & { summary: NonNullable<(typeof c)['summary']> } =>
                  c.orderIndex < chapter.orderIndex && c.summary !== null,
              )
              .map((c) => ({ orderIndex: c.orderIndex, title: c.title, summary: c.summary }))
          : undefined;

        // ── 6. Build prompt from chapter + story context ──────────────────────
        const chapterContent = tipTapJsonToText(chapter.bodyJson ?? null);
        const worldNotes = typeof story.worldNotes === 'string' ? story.worldNotes : null;

        // Route by chat.kind: scene chats use the scene action (raw direction as
        // user message, scene template in system); ask chats use the ask action.
        const action: 'ask' | 'scene' = chat.kind === 'scene' ? 'scene' : 'ask';

        // On replay, use the anchor's stored content as the user instruction so
        // the prompt builder assembles the system message correctly. On a normal
        // turn use body.content (guaranteed non-empty by superRefine).
        // Both retry and fromMessageId paths have validated anchor is non-null
        // and role==='user' above; we extract to a local to satisfy TypeScript.
        // anchor is non-null whenever isReplay (both validation guards above
        // early-return otherwise); TS can't narrow through the ternary.
        const trailingUserContent: string = isReplay ? anchor!.content : (body.content as string);

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
          previousChapters,
          modelContextLength,
          modelMaxCompletionTokens,
          // Pass POSITIVE_INFINITY so the prompt builder uses the model's own cap
          // for context-budget calculations. The resolved per-user max_completion_tokens
          // is what actually goes to Venice.
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
        // [k1r] On replay the trailing history entry equals what buildUserPayload
        // would emit for the same inputs (built from anchor.content +
        // anchor.attachmentJson under the unified history mapping). So the replay
        // path uses [systemMsg, ...history] and the trailing entry IS the user
        // message — chapter / characters / world-notes context lives in systemMsg
        // in both branches, so the 9ph context-loss bug is structurally impossible.
        const messages: Array<{ role: MessageRole; content: string }> = isReplay
          ? [systemMsg, ...history]
          : [systemMsg, ...history, synthesisedUserMsg];

        // ── 9a. Persist the user message BEFORE calling Venice (normal turn only)
        // Replay paths (retry / fromMessageId) reuse the anchor — do NOT re-create.
        if (!isReplay) {
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

        // ── 9b. Get Venice client + prepare the request ───────────────────────
        const client = await veniceKeyService.getClient(getDekFromRequest(req), userId);

        const startedAt = Date.now();
        const prepared = prepareVeniceCall({
          route: 'chat',
          userId,
          modelId: body.modelId,
          messages,
          settings,
          baseVeniceParams,
          fallbackMaxCompletionTokens: max_completion_tokens,
          cacheKeyParts: [chatId, body.modelId],
          action,
          modelCap: modelMaxCompletionTokens,
          enableWebSearch: body.enableWebSearch === true,
          enableChatStreamHints: body.enableWebSearch === true,
          includeUsage: true,
        });
        snapshot = prepared.snapshot;

        // ── 10-13. Stream chunks; citation latch + content/usage accumulation +
        // assistant-message persistence survive via hooks (chat-only behavior). ──
        let accumulatedContent = '';
        let capturedTotalTokens: number | null = null;
        // [V26] Citation capture state. `citationsHandled` latches on the first
        // `venice_search_results` chunk (valid or malformed) so a later
        // duplicate chunk can't re-trigger. `capturedCitations` stays null
        // when Venice returned no valid results — that null gets persisted
        // verbatim (null ≠ [] per §6).
        let citationsHandled = false;
        let capturedCitations: Citation[] | null = null;

        await streamVeniceToResponse({
          client,
          req,
          res,
          prepared,
          ctx: { userId, route: 'chat' },
          hooks: {
            onChunk: (chunk, write) => {
              // [V26] Venice's `include_search_results_in_stream: true` adds a
              // non-standard first chunk carrying `venice_search_results`. We
              // CONSUME this chunk (do not forward it to the client) and
              // instead emit a single `event: citations` SSE frame before any
              // content frame. Empty / malformed results → latch, emit nothing.
              if (!citationsHandled && chunk.venice_search_results !== undefined) {
                citationsHandled = true;
                const projected = projectVeniceCitations(chunk.venice_search_results);
                if (projected.length > 0) {
                  capturedCitations = projected;
                  write(`event: citations\ndata: ${JSON.stringify({ citations: projected })}\n\n`);
                }
                return 'consume';
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

              return 'forward';
            },
            onDone: async () => {
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
                // Bound to the message: a raw error object could theoretically
                // serialize row data if a future ORM error shape echoed values.
                console.error(
                  '[V15] Failed to persist assistant message',
                  persistErr instanceof Error ? persistErr.message : persistErr,
                );
              }
            },
          },
        });
      } catch (err) {
        // Pre-stream error — map Venice errors to JSON, let global handler deal with others.
        logVeniceErrorDev({ err, ctx: { userId, route: 'chat' }, request: snapshot });
        if (mapVeniceError(err, res, { userId, route: 'chat' })) return;
        throw err;
      }
    }),
  );

  return router;
}
