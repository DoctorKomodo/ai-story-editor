// [story-editor-046] Schema-driven backup round-trip parity test.
//
// Two-layer tripwire — read this before touching export.service.ts or
// import.service.ts's field mappings:
//
//   Layer 1 (COVERAGE): every per-entity schema below is derived from the
//   shared `exportSchema`'s own nesting (stories -> chapters -> chats ->
//   messages, and stories -> characters / outlineItems) — never a
//   hand-written field list. For every key in each schema's `.shape` (minus
//   the documented allowlist), `assertCoverage` asserts the value is
//   non-undefined in the FIRST export of the maximal fixture built below.
//   This forces two things at once: the fixture must set the field to a
//   real value, and export.service.ts must actually emit it — a schema key
//   that's merely optional-and-unset in the export mapping fails here.
//
//   Layer 2 (FIDELITY): for the same key set, `assertFidelity` asserts the
//   SECOND export's imported copy deep-equals the first export's original,
//   field by field. This forces import.service.ts to persist the value and
//   re-derive it identically on the way back out.
//
//   Neither layer alone is a real tripwire. Coverage alone doesn't catch a
//   field that import silently drops (export1 has it, export2 doesn't —
//   only fidelity sees that). Fidelity alone doesn't catch a field that's
//   absent from BOTH exports (never wired up anywhere — a deep-equal of
//   "undefined" against "undefined" passes trivially). Only the pair
//   together guarantees that adding a field to an export schema without
//   updating both the fixture/export mapping and the import mapping fails
//   this test.
//
// Documented allowlist of spec'd lossiness (see the plan doc): story `id`,
// story `snapshotUpdatedAt`, message `createdAt`. Everything else must
// survive the round trip unchanged.

import { exportSchema } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChapterRepo } from '../../src/repos/chapter.repo';
import { createCharacterRepo } from '../../src/repos/character.repo';
import { createChatRepo } from '../../src/repos/chat.repo';
import { createMessageRepo } from '../../src/repos/message.repo';
import { createOutlineRepo } from '../../src/repos/outline.repo';
import { createStoryRepo } from '../../src/repos/story.repo';
import { buildExport } from '../../src/services/export.service';
import { runImport } from '../../src/services/import.service';
import { resetDb } from '../helpers/db';
import { makeUserContext } from '../repos/_req';

// Derive per-entity schemas from the shared exportSchema's own array nesting
// — `.unwrap()` strips the `.default([])`, `.element` gives the item schema.
// Never hand-declare these field lists; that would defeat the tripwire.
const storyExportSchema = exportSchema.shape.stories.unwrap().element;
const chapterExportSchema = storyExportSchema.shape.chapters.unwrap().element;
const chatExportSchema = chapterExportSchema.shape.chats.unwrap().element;
const messageExportSchema = chatExportSchema.shape.messages.unwrap().element;
const characterExportSchema = storyExportSchema.shape.characters.unwrap().element;
const outlineExportSchema = storyExportSchema.shape.outlineItems.unwrap().element;

// Allowlist (spec'd lossiness) unioned with nested-collection keys, which are
// recursed into separately rather than deep-equal'd at the parent level.
const STORY_EXCLUDE = [
  'id',
  'snapshotUpdatedAt',
  'chapters',
  'characters',
  'outlineItems',
] as const;
const CHAPTER_EXCLUDE = ['chats'] as const;
const CHAT_EXCLUDE = ['messages'] as const;
const MESSAGE_EXCLUDE = ['createdAt'] as const;
const CHARACTER_EXCLUDE = [] as const;
const OUTLINE_EXCLUDE = [] as const;

function keysOf(shape: object, exclude: readonly string[]): string[] {
  return Object.keys(shape).filter((k) => !exclude.includes(k));
}

/** Layer 1: every schema key must be a real, non-undefined value in the fixture's own export. */
function assertCoverage(
  shape: object,
  exclude: readonly string[],
  obj: object,
  label: string,
): void {
  // Dynamic key-driven field access needs an index signature; the schema's
  // own key set (not this cast) is what keeps the access honest.
  const rec = obj as Record<string, unknown>;
  for (const key of keysOf(shape, exclude)) {
    expect(
      rec[key],
      `${label}.${key} is undefined in the fixture's export — set it to a non-default value in the fixture and confirm export.service.ts emits it`,
    ).not.toBeUndefined();
  }
}

/** Layer 2: every schema key must survive the export -> import -> export round trip unchanged. */
function assertFidelity(
  shape: object,
  exclude: readonly string[],
  original: object,
  imported: object,
  label: string,
): void {
  const orig = original as Record<string, unknown>;
  const imp = imported as Record<string, unknown>;
  for (const key of keysOf(shape, exclude)) {
    expect(
      imp[key],
      `${label}.${key} did not round-trip through import — check import.service.ts's mapping`,
    ).toEqual(orig[key]);
  }
}

const FIXTURE_STORY_TITLE = 'ROUNDTRIP MAXIMAL STORY';

describe('[story-editor-046] backup export -> import -> export round-trip parity', () => {
  beforeEach(resetDb);
  afterEach(resetDb);

  it('every exportable field survives create-on-import, except the documented allowlist', async () => {
    const ctx = await makeUserContext('roundtrip-user');
    const storyRepo = createStoryRepo(ctx.req);
    const chapterRepo = createChapterRepo(ctx.req);
    const characterRepo = createCharacterRepo(ctx.req);
    const outlineRepo = createOutlineRepo(ctx.req);
    const chatRepo = createChatRepo(ctx.req);
    const messageRepo = createMessageRepo(ctx.req);

    // --- Build a maximal library through the repo layer: every entity,
    // every exportable field set to a non-default value. ---
    const story = await storyRepo.create({
      title: FIXTURE_STORY_TITLE,
      synopsis: 'A synopsis with real content.',
      genre: 'Gothic fantasy',
      worldNotes: 'The lantern never goes out.',
      targetWords: 90_000,
    });
    // create() ignores includePreviousChaptersInPrompt (column @default(true));
    // set it to the NON-default false via update(), same as import.service.ts does.
    await storyRepo.update(story.id, { includePreviousChaptersInPrompt: false });

    const chapter = await chapterRepo.create({
      storyId: story.id,
      title: 'Chapter One',
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Roundtrip body text.' }] }],
      },
      orderIndex: 0,
    });
    await chapterRepo.update(chapter.id, {
      summaryJson: {
        events: 'The hero crosses the threshold.',
        stateAtEnd: 'Alone at the gate.',
        openThreads: 'A riddle left unanswered.',
      },
    });

    const chat = await chatRepo.create({
      draftId: chapter.activeDraftId as string,
      title: 'Scene chat',
      kind: 'scene', // non-default (ask)
    });
    await messageRepo.create({
      chatId: chat.id,
      role: 'assistant',
      content: 'Message content for the round trip.',
      attachmentJson: { selectionText: 'selected prose', chapterId: chapter.id },
      citationsJson: [
        {
          title: 'Cited source',
          url: 'https://example.com/source',
          snippet: 'a snippet of the source',
          publishedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      model: 'venice-model-x',
      tokens: 321,
      latencyMs: 842,
    });

    await characterRepo.create({
      storyId: story.id,
      orderIndex: 0,
      name: 'Maren',
      role: 'protagonist',
      age: '29',
      appearance: 'tall, grey-eyed',
      personality: 'guarded but loyal',
      voice: 'clipped, dry wit',
      backstory: 'left the coast at sixteen',
      arc: 'learns to trust again',
      relationships: 'estranged from her brother',
      color: '#336699',
      initial: 'M',
    });

    await outlineRepo.create({
      storyId: story.id,
      order: 0,
      title: 'Inciting incident',
      sub: 'the gate opens at midnight',
      status: 'active',
    });

    // --- First export: the source of truth for both tripwire layers. ---
    const export1 = await buildExport(ctx.req);
    const story1 = export1.stories.find((s) => s.title === FIXTURE_STORY_TITLE);
    expect(story1, 'fixture story missing from first export').toBeDefined();
    const chapter1 = story1!.chapters[0];
    const chat1 = chapter1?.chats[0];
    const message1 = chat1?.messages[0];
    const character1 = story1!.characters[0];
    const outline1 = story1!.outlineItems[0];
    expect(chapter1, 'fixture chapter missing from first export').toBeDefined();
    expect(chat1, 'fixture chat missing from first export').toBeDefined();
    expect(message1, 'fixture message missing from first export').toBeDefined();
    expect(character1, 'fixture character missing from first export').toBeDefined();
    expect(outline1, 'fixture outline item missing from first export').toBeDefined();

    // Layer 1: coverage over every schema-derived key set.
    assertCoverage(storyExportSchema.shape, STORY_EXCLUDE, story1!, 'story');
    assertCoverage(chapterExportSchema.shape, CHAPTER_EXCLUDE, chapter1!, 'chapter');
    assertCoverage(chatExportSchema.shape, CHAT_EXCLUDE, chat1!, 'chat');
    assertCoverage(messageExportSchema.shape, MESSAGE_EXCLUDE, message1!, 'message');
    assertCoverage(characterExportSchema.shape, CHARACTER_EXCLUDE, character1!, 'character');
    assertCoverage(outlineExportSchema.shape, OUTLINE_EXCLUDE, outline1!, 'outlineItem');

    // --- Import as all-default create (no resolutions passed). ---
    const importResult = await runImport(ctx.req, { file: export1 });
    expect(importResult.outcomes).toEqual([{ index: 0, action: 'created' }]);
    expect(importResult.imported).toEqual({
      stories: 1,
      chapters: 1,
      characters: 1,
      outlineItems: 1,
      chats: 1,
      messages: 1,
    });

    // --- Second export: the round-tripped copy. Match by title since a
    // `create` mints a fresh id — ordering across stories isn't semantic. ---
    const export2 = await buildExport(ctx.req);
    const originalIds = new Set(export1.stories.map((s) => s.id));
    const imported = export2.stories.find(
      (s) => s.title === FIXTURE_STORY_TITLE && !originalIds.has(s.id as string),
    );
    expect(imported, 'imported copy missing from second export').toBeDefined();

    // Fresh-id assertion: a `create` must never adopt the file's id — neither
    // this story's own id nor any other live id present in the first export.
    expect(imported!.id).not.toBe(story1!.id);
    expect(originalIds.has(imported!.id as string)).toBe(false);

    const chapter2 = imported!.chapters[0];
    const chat2 = chapter2?.chats[0];
    const message2 = chat2?.messages[0];
    const character2 = imported!.characters[0];
    const outline2 = imported!.outlineItems[0];

    // Layer 2: fidelity over the same schema-derived key sets.
    assertFidelity(storyExportSchema.shape, STORY_EXCLUDE, story1!, imported!, 'story');
    assertFidelity(chapterExportSchema.shape, CHAPTER_EXCLUDE, chapter1!, chapter2!, 'chapter');
    assertFidelity(chatExportSchema.shape, CHAT_EXCLUDE, chat1!, chat2!, 'chat');
    assertFidelity(messageExportSchema.shape, MESSAGE_EXCLUDE, message1!, message2!, 'message');
    assertFidelity(
      characterExportSchema.shape,
      CHARACTER_EXCLUDE,
      character1!,
      character2!,
      'character',
    );
    assertFidelity(outlineExportSchema.shape, OUTLINE_EXCLUDE, outline1!, outline2!, 'outlineItem');
  });
});
