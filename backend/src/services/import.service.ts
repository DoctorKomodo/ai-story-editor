import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type {
  ImportFile,
  ImportPlanRequest,
  ImportPlanResponse,
  ImportRequest,
  ImportResolution,
  ImportResult,
} from 'story-editor-shared';
import { prisma } from '../lib/prisma';
import { createChapterRepo } from '../repos/chapter.repo';
import { createCharacterRepo } from '../repos/character.repo';
import { createChatRepo } from '../repos/chat.repo';
import { createDraftRepo } from '../repos/draft.repo';
import { createMessageRepo } from '../repos/message.repo';
import { createOutlineRepo } from '../repos/outline.repo';
import { createStoryRepo } from '../repos/story.repo';
import { computeWordCount } from './tiptap-text';

/**
 * Preflight: bucket each file-story id against the caller's live stories
 * without mutating anything. `findById` is owner-scoped and returns `null`
 * for both an unknown id and one owned by another user — so a story that
 * isn't live-and-owned always reports `new`, never leaking its existence.
 */
export async function planImport(
  req: Request,
  plan: ImportPlanRequest,
): Promise<ImportPlanResponse> {
  const storyRepo = createStoryRepo(req);
  const stories = await Promise.all(
    plan.stories.map(async ({ id, snapshotUpdatedAt }) => {
      const live = await storyRepo.findById(id);
      if (!live) return { id, status: 'new' as const };
      const liveMax = await storyRepo.contentUpdatedAtMax(id);
      const status: ImportPlanResponse['stories'][number]['status'] =
        liveMax.getTime() <= new Date(snapshotUpdatedAt).getTime() ? 'unchanged' : 'conflict';
      return { id, status };
    }),
  );
  return { stories };
}

type StoryFile = ImportFile['stories'][number];
type ImportCounts = ImportResult['imported'];
type StoryOutcomeAction = NonNullable<ImportResult['outcomes']>[number]['action'];

function zeroCounts(): ImportCounts {
  return {
    stories: 0,
    chapters: 0,
    drafts: 0,
    characters: 0,
    outlineItems: 0,
    chats: 0,
    messages: 0,
  };
}

/**
 * Create (and, for `replace`, first delete) one story inside its own
 * transaction. `replace` only deletes when `s.id` names a story the caller
 * actually owns — `storyRepo.remove` is owner-scoped (`deleteMany({ id,
 * userId })`), so an id belonging to another user, or no live story at all,
 * simply deletes nothing and this falls back to a plain create.
 */
async function importOneStory(
  req: Request,
  s: StoryFile,
  resolution: 'create' | 'replace',
): Promise<{ action: 'created' | 'replaced'; counts: ImportCounts }> {
  return prisma.$transaction(
    async (tx) => {
      // The tx client substitutes for PrismaClient at runtime. A repo method that
      // opens its own $transaction (chapter.repo/draft.repo/chat.repo create — each
      // now wraps createWithin in $transaction) joins this ongoing transaction
      // rather than escaping it — confirmed empirically: an outer rollback also
      // rolls back its inner writes. So the repos below are bound to txc and use
      // their normal create(), which nests into and joins this tx. One cast:
      const txc = tx as unknown as PrismaClient;
      const storyRepo = createStoryRepo(req, txc);
      const chapterRepo = createChapterRepo(req, txc);
      const characterRepo = createCharacterRepo(req, txc);
      const outlineRepo = createOutlineRepo(req, txc);
      const chatRepo = createChatRepo(req, txc);
      const draftRepo = createDraftRepo(req, txc);
      // Messages are the one exception: messageRepo stays on the DEFAULT prisma
      // client (no txc) and the import threads the outer tx explicitly via
      // createWithin(tx, …), so message inserts still land inside this transaction.
      const messageRepo = createMessageRepo(req);

      const counts = zeroCounts();
      let action: 'created' | 'replaced' = 'created';
      if (resolution === 'replace' && s.id) {
        const removed = await storyRepo.remove(s.id);
        if (removed) action = 'replaced';
      }

      // A replace keeps the live story's id (we just deleted it, same tx), so
      // an editor open on that story refetches the replaced content instead of
      // 404ing into the "Could not load story" dead-end ([story-editor-f1t]).
      // A create — including the forged/unknown-id fallback where remove()
      // deleted nothing — never adopts the file's id.
      const story = await storyRepo.create(
        {
          title: s.title,
          synopsis: s.synopsis ?? null,
          genre: s.genre ?? null,
          worldNotes: s.worldNotes ?? null,
          targetWords: s.targetWords ?? null,
        },
        action === 'replaced' && s.id ? { id: s.id } : undefined,
      );
      counts.stories++;

      // storyRepo.create() does not write includePreviousChaptersInPrompt — the
      // column has @default(true) and create() ignores the field. Set it via
      // update() so the flag round-trips faithfully (a false would re-import as true).
      if (typeof s.includePreviousChaptersInPrompt === 'boolean') {
        await storyRepo.update(story.id, {
          includePreviousChaptersInPrompt: s.includePreviousChaptersInPrompt,
        });
      }

      const chapters = [...s.chapters].sort((a, b) => a.orderIndex - b.orderIndex);
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i]!;
        const drafts = [...ch.drafts].sort((a, b) => a.orderIndex - b.orderIndex);
        const first = drafts[0]!; // schema guarantees min(1)

        // [9wk.5] Mint-as-first-draft (design D3): chapter.repo.create's
        // unconditional mint IS drafts[0] — no repo path ever yields a
        // draft-less chapter, even mid-transaction.
        const created = await chapterRepo.create({
          storyId: story.id,
          title: ch.title,
          bodyJson: first.bodyJson,
          orderIndex: i,
          wordCount: computeWordCount(first.bodyJson),
        });
        counts.chapters++;

        if (created.activeDraftId === null) {
          throw new Error('import: minted chapter has no active draft');
        }
        counts.drafts++;
        const draftIds: string[] = [created.activeDraftId];

        if (first.label !== null || first.summary !== null) {
          // ONE combined call (spec §5): a later label-only update would bump
          // @updatedAt past summaryJsonUpdatedAt and spuriously stale the
          // just-written summary.
          await draftRepo.update(created.activeDraftId, {
            ...(first.label !== null ? { label: first.label } : {}),
            ...(first.summary !== null ? { summaryJson: first.summary } : {}),
          });
        }

        for (let j = 1; j < drafts.length; j++) {
          const d = drafts[j]!;
          const row = await draftRepo.create({
            chapterId: created.id,
            bodyJson: d.bodyJson,
            wordCount: computeWordCount(d.bodyJson),
            label: d.label,
            summaryJson: d.summary,
            // Densified from the loop index (same convention as chapters/
            // characters/outline) — a gappy hand-edited file can't violate
            // @@unique([chapterId, orderIndex]).
            orderIndex: j,
          });
          counts.drafts++;
          draftIds.push(row.id);
        }

        const activeIdx = drafts.findIndex((d) => d.isActive);
        if (activeIdx > 0) {
          // Refine guarantees exactly one isActive; idx 0 is already active
          // via the mint.
          const ok = await draftRepo.setActive(created.id, draftIds[activeIdx]!);
          if (!ok) throw new Error('import: could not set active draft');
        }

        for (let j = 0; j < drafts.length; j++) {
          for (const c of drafts[j]!.chats) {
            const chat = await chatRepo.create({
              draftId: draftIds[j]!,
              title: c.title ?? null,
              kind: c.kind,
            });
            counts.chats++;

            for (const m of c.messages) {
              await messageRepo.createWithin(tx, {
                chatId: chat.id,
                role: m.role,
                content: m.content,
                attachmentJson: m.attachmentJson,
                citationsJson: m.citationsJson,
                model: m.model,
                tokens: m.tokens,
                latencyMs: m.latencyMs,
              });
              counts.messages++;
            }
          }
        }
      }

      const chars = [...s.characters].sort((a, b) => a.orderIndex - b.orderIndex);
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i]!;
        await characterRepo.create({
          storyId: story.id,
          orderIndex: i,
          name: c.name,
          role: c.role,
          age: c.age,
          appearance: c.appearance,
          personality: c.personality,
          voice: c.voice,
          backstory: c.backstory,
          arc: c.arc,
          relationships: c.relationships,
          color: c.color,
          initial: c.initial,
        });
        counts.characters++;
      }

      const items = [...s.outlineItems].sort((a, b) => a.order - b.order);
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        await outlineRepo.create({
          storyId: story.id,
          order: i,
          title: it.title,
          sub: it.sub ?? null,
          status: it.status,
        });
        counts.outlineItems++;
      }

      return { action, counts };
    },
    { maxWait: 5_000, timeout: 120_000 },
  );
}

export async function runImport(
  req: Request,
  { file, resolutions }: ImportRequest,
): Promise<ImportResult> {
  const counts = zeroCounts();
  const outcomes: { index: number; action: StoryOutcomeAction }[] = [];

  for (let index = 0; index < file.stories.length; index++) {
    const s = file.stories[index]!;
    const resolution: ImportResolution = s.id ? (resolutions?.[s.id] ?? 'create') : 'create';

    if (resolution === 'skip') {
      outcomes.push({ index, action: 'skipped' });
      continue;
    }

    try {
      const { action, counts: storyCounts } = await importOneStory(req, s, resolution);
      counts.stories += storyCounts.stories;
      counts.chapters += storyCounts.chapters;
      counts.drafts += storyCounts.drafts;
      counts.characters += storyCounts.characters;
      counts.outlineItems += storyCounts.outlineItems;
      counts.chats += storyCounts.chats;
      counts.messages += storyCounts.messages;
      outcomes.push({ index, action });
    } catch (err) {
      // The story's own $transaction has already rolled back. Report the
      // failure by index only (never title/content, per the no-leak rule)
      // and abort — remaining stories get no outcome entry at all. The
      // exception itself may embed decrypted narrative content (e.g. a
      // parse error over a crafted bodyJson) so it's never logged outside
      // the dev-only gate below.
      console.error(`import_story_failed index=${index}`);
      if (process.env.NODE_ENV !== 'production') {
        console.error('[import.dev]', err);
      }
      outcomes.push({ index, action: 'failed' });
      break;
    }
  }

  return { imported: counts, outcomes };
}
