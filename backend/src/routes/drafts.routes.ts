// [9wk.4] Draft routes — live ALONGSIDE the old chapter-mounted endpoints
// (chapters.routes.ts) until the step-5 cutover removes the latter.
//
// Three router factories, mirroring the chat.routes.ts precedent:
//   createChapterDraftsRouter()  — /api/chapters/:chapterId/drafts   (list, create)
//   createActiveDraftRouter()    — /api/chapters/:chapterId/active-draft (set active)
//   createDraftCrudRouter()      — /api/drafts                       (get/patch/delete/summary/summarise)

import { Prisma } from '@prisma/client';
import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  activeDraftPutSchema,
  chapterSummaryJsonSchema,
  chapterSummaryResponseSchema,
  chapterSummarySchema,
  draftCreateSchema,
  draftResponseSchema,
  draftsResponseSchema,
  draftUpdateSchema,
} from 'story-editor-shared';
import { z } from 'zod';
import { notFound } from '../lib/http-errors';
import { respond } from '../lib/respond';
import { serializeDraft, serializeDraftMeta } from '../lib/serialize';
import { logVeniceErrorDev, mapVeniceError } from '../lib/venice-errors';
import { requireAuth } from '../middleware/auth.middleware';
import { requireOwnership } from '../middleware/ownership.middleware';
import { validateBody } from '../middleware/validate';
import { createChapterRepo } from '../repos/chapter.repo';
import { createDraftRepo, type RepoDraftUpdateInput } from '../repos/draft.repo';
import { getDekFromRequest } from '../services/content-crypto.service';
import { resolvePrompt } from '../services/prompt.service';
import { computeWordCount, tipTapJsonToText } from '../services/tiptap-text';
import { veniceModelsService } from '../services/venice.models.service';
import { hydrateUserSettings } from '../services/venice-call.service';
import { veniceKeyService } from '../services/venice-key.service';
import { callVeniceCompletion, prepareVeniceCall } from '../services/venice-stream.service';

// [D16]/mirrors chapters.routes.ts — two concurrent fork/blank creates can
// compute the same `nextOrderIndex`; @@unique([chapterId, orderIndex])
// rejects the loser with P2002, and re-running the create picks up the
// winner's row.
const POST_ORDER_RETRY_ATTEMPTS = 3;

function isPrismaUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function isActiveDraft(req: Request, chapterId: string, draftId: string): Promise<boolean> {
  const chapter = await createChapterRepo(req).findById(chapterId);
  return chapter?.activeDraftId === draftId;
}

// ─── Router 1: chapter-scoped draft list + create ────────────────────────────

export function createChapterDraftsRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const ownChapter = requireOwnership('chapter', { idParam: 'chapterId' });

  router.get('/', ownChapter, async (req: Request, res: Response, next: NextFunction) => {
    const chapterId = req.params.chapterId as string;
    try {
      const rows = await createDraftRepo(req).findManyMetaForChapter(chapterId);
      respond(draftsResponseSchema, res, { drafts: rows.map(serializeDraftMeta) });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/',
    ownChapter,
    validateBody(draftCreateSchema, async (body, req, res) => {
      const chapterId = req.params.chapterId as string;
      const repo = createDraftRepo(req);

      let lastErr: unknown;
      let created: Awaited<ReturnType<typeof repo.createFork>> | null = null;
      for (let attempt = 0; attempt < POST_ORDER_RETRY_ATTEMPTS; attempt++) {
        try {
          created =
            body.mode === 'fork'
              ? await repo.createFork(chapterId, body.label)
              : await repo.createBlank(chapterId, body.label);
          break;
        } catch (err) {
          if (!isPrismaUniqueViolation(err)) throw err;
          lastErr = err;
          // loop — re-aggregate picks up the winning row.
        }
      }

      if (created === null) {
        throw lastErr ?? new Error('drafts POST: failed to allocate orderIndex');
      }

      const isActive = await isActiveDraft(req, chapterId, created.id);
      respond(draftResponseSchema, res, { draft: serializeDraft(created, isActive) }, 201);
    }),
  );

  return router;
}

// ─── Router 2: chapter-scoped active-draft pointer ───────────────────────────

export function createActiveDraftRouter() {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  const ownChapter = requireOwnership('chapter', { idParam: 'chapterId' });

  router.put(
    '/',
    ownChapter,
    validateBody(activeDraftPutSchema, async (body, req, res) => {
      const chapterId = req.params.chapterId as string;
      const ok = await createDraftRepo(req).setActive(chapterId, body.draftId);
      if (!ok) throw notFound();
      res.status(204).send();
    }),
  );

  return router;
}

// ─── Router 3: draft-level CRUD + summary + summarise ────────────────────────

const SummariseBody = z.object({ modelId: z.string().min(1) });

export function createDraftCrudRouter() {
  const router = Router();
  router.use(requireAuth);

  const ownDraft = requireOwnership('draft', { idParam: 'draftId' });

  router.get('/:draftId', ownDraft, async (req: Request, res: Response, next: NextFunction) => {
    const draftId = req.params.draftId as string;
    try {
      const draft = await createDraftRepo(req).findById(draftId);
      if (!draft) throw notFound();
      const isActive = await isActiveDraft(req, draft.chapterId, draft.id);
      respond(draftResponseSchema, res, { draft: serializeDraft(draft, isActive) });
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    '/:draftId',
    ownDraft,
    validateBody(draftUpdateSchema, async (body, req, res) => {
      const draftId = req.params.draftId as string;

      const input: RepoDraftUpdateInput = {};
      if (body.label !== undefined) input.label = body.label;
      if (body.bodyJson !== undefined) {
        input.bodyJson = body.bodyJson;
        input.wordCount = computeWordCount(body.bodyJson);
      }

      const updated = await createDraftRepo(req).update(
        draftId,
        input,
        body.expectedUpdatedAt !== undefined
          ? { expectedUpdatedAt: new Date(body.expectedUpdatedAt) }
          : undefined,
      );
      if (!updated) throw notFound();
      const isActive = await isActiveDraft(req, updated.chapterId, updated.id);
      respond(draftResponseSchema, res, { draft: serializeDraft(updated, isActive) });
    }),
  );

  router.delete('/:draftId', ownDraft, async (req: Request, res: Response, next: NextFunction) => {
    const draftId = req.params.draftId as string;
    try {
      const ok = await createDraftRepo(req).remove(draftId);
      if (!ok) throw notFound();
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/:draftId/summary',
    ownDraft,
    validateBody(chapterSummarySchema, async (body, req, res) => {
      const draftId = req.params.draftId as string;

      const updated = await createDraftRepo(req).update(draftId, { summaryJson: body });
      if (!updated) throw notFound('Draft not found');
      respond(chapterSummaryResponseSchema, res, {
        summary: updated.summary!,
        summaryUpdatedAt: updated.summaryUpdatedAt?.toISOString() ?? null,
      });
    }),
  );

  router.post(
    '/:draftId/summarise',
    ownDraft,
    validateBody(SummariseBody, async (body, req, res) => {
      const userId = req.user!.id;
      const draftId = req.params.draftId as string;

      const draft = await createDraftRepo(req).findById(draftId);
      if (!draft) throw notFound('Draft not found');

      const plaintext = tipTapJsonToText(draft.bodyJson ?? null).trim();
      if (plaintext.length === 0 || draft.wordCount === 0) {
        res
          .status(400)
          .json({ error: { message: 'Chapter has no body to summarise', code: 'empty_chapter' } });
        return;
      }

      try {
        await veniceModelsService.fetchModels(getDekFromRequest(req), userId);
      } catch (err) {
        if (mapVeniceError(err, res, { userId, route: 'draft-summarise' })) return;
        throw err;
      }

      const modelInfo = veniceModelsService.findModel(body.modelId, userId);
      if (!modelInfo || modelInfo.supportsResponseSchema === false) {
        res.status(400).json({
          error: {
            message:
              "This model doesn't support structured output — switch to a schema-capable model.",
            code: 'model_unsupported_for_summarisation',
          },
        });
        return;
      }

      const { settings, includeVeniceSystemPrompt, userPrompts } =
        await hydrateUserSettings(userId);

      const systemMessage = `${resolvePrompt(userPrompts, 'system')}\n\n${resolvePrompt(userPrompts, 'summariseChapter')}`;

      const prepared = prepareVeniceCall({
        route: 'draft-summarise',
        userId,
        modelId: body.modelId,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: plaintext },
        ],
        settings,
        baseVeniceParams: {},
        fallbackMaxCompletionTokens: modelInfo.maxCompletionTokens,
        cacheKeyParts: [draftId, body.modelId],
        action: 'summariseChapter',
        modelCap: modelInfo.maxCompletionTokens,
        includeVeniceSystemPrompt,
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'ChapterSummary',
            schema: chapterSummaryJsonSchema(),
            strict: true,
          },
        },
        snapshotResponseFormat: { type: 'json_schema', name: 'ChapterSummary' },
      });
      const snapshot = prepared.snapshot;

      const client = await veniceKeyService.getClient(getDekFromRequest(req), userId);
      let raw: Awaited<ReturnType<typeof callVeniceCompletion>>;
      try {
        raw = await callVeniceCompletion({ client, prepared });
      } catch (err) {
        logVeniceErrorDev({ err, ctx: { userId, route: 'draft-summarise' }, request: snapshot });
        if (mapVeniceError(err, res, { userId, route: 'draft-summarise' })) return;
        throw err;
      }

      const content = raw.choices?.[0]?.message?.content ?? '';
      let parsed: ReturnType<typeof chapterSummarySchema.parse>;
      try {
        parsed = chapterSummarySchema.parse(JSON.parse(content));
      } catch (parseErr) {
        logVeniceErrorDev({
          err: parseErr,
          ctx: { userId, route: 'draft-summarise' },
          request: snapshot,
          rawContent: content,
        });
        res.status(502).json({
          error: {
            message: 'Venice returned a malformed summary.',
            code: 'summary_parse_failed',
          },
        });
        return;
      }

      const updated = await createDraftRepo(req).update(draftId, { summaryJson: parsed });
      if (!updated) throw notFound('Draft not found');
      respond(chapterSummaryResponseSchema, res, {
        summary: updated.summary!,
        summaryUpdatedAt: updated.summaryUpdatedAt?.toISOString() ?? null,
      });
    }),
  );

  return router;
}
