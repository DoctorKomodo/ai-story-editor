import type {
  Chapter,
  ChapterMeta,
  Character,
  Chat,
  Draft,
  DraftMeta,
  Message,
  OutlineItem,
  Story,
} from 'story-editor-shared';
import type { RepoChapter, RepoChapterMeta } from '../repos/chapter.repo';
import type { RepoCharacter } from '../repos/character.repo';
import type { RepoChat } from '../repos/chat.repo';
import type { RepoDraft, RepoDraftMeta } from '../repos/draft.repo';
import type { RepoMessage } from '../repos/message.repo';
import type { RepoOutlineItem } from '../repos/outline.repo';
import type { RepoStory } from '../repos/story.repo';

// Explicit pick (not spread): keeps every serialize* helper on one safe
// pattern. RepoCharacter happens to carry no extra runtime columns today, so
// pick and spread produce identical output — but picking hardens the example
// so a future entity author doesn't copy a spread that leaks an extra column.
export function serializeCharacter(row: RepoCharacter): Character {
  return {
    id: row.id,
    storyId: row.storyId,
    name: row.name,
    role: row.role,
    age: row.age,
    appearance: row.appearance,
    personality: row.personality,
    voice: row.voice,
    backstory: row.backstory,
    arc: row.arc,
    relationships: row.relationships,
    orderIndex: row.orderIndex,
    color: row.color,
    initial: row.initial,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Explicit pick (not spread): RepoMessage's type omits chatId, but the runtime
// row still carries it because projectDecrypted only strips ciphertext-triple
// columns. Spreading into messagesResponseSchema (strictObject) would throw.
export function serializeMessage(row: RepoMessage): Message {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    attachmentJson: row.attachmentJson,
    citationsJson: row.citationsJson,
    model: row.model,
    tokens: row.tokens,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

// Explicit pick (not spread): forces the compiler to surface any repo field
// the wire shape does NOT carry (matches serializeMessage / serializeOutlineItem).
export function serializeChat(row: RepoChat): Chat {
  return {
    id: row.id,
    draftId: row.draftId,
    title: row.title,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
  };
}

// Explicit pick (not spread): RepoStory's type omits userId, but the runtime
// row still carries it because projectDecrypted only strips ciphertext-triple
// columns. Spreading into storySchema (strictObject) would throw — same
// situation as serializeMessage / chatId.
export function serializeStory(row: RepoStory): Story {
  return {
    id: row.id,
    title: row.title,
    synopsis: row.synopsis,
    genre: row.genre,
    worldNotes: row.worldNotes,
    targetWords: row.targetWords,
    includePreviousChaptersInPrompt: row.includePreviousChaptersInPrompt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Explicit pick (not spread): keeps every serialize* helper on one safe
// pattern. RepoOutlineItem happens to carry no extra runtime columns today,
// but picking hardens the example so a future entity author doesn't copy a
// spread that leaks an extra column.
export function serializeOutlineItem(row: RepoOutlineItem): OutlineItem {
  return {
    id: row.id,
    storyId: row.storyId,
    title: row.title,
    sub: row.sub,
    status: row.status,
    order: row.order,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Explicit pick (not spread): forces the compiler to surface any repo field
// the wire shape does NOT carry. projectDecrypted strips ciphertext triples
// but nothing else — a future non-ciphertext column on the Prisma row would
// otherwise slip into the response.
export function serializeChapter(row: RepoChapter): Chapter {
  return {
    id: row.id,
    storyId: row.storyId,
    title: row.title,
    bodyJson: row.bodyJson,
    wordCount: row.wordCount,
    orderIndex: row.orderIndex,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hasSummary: row.hasSummary,
    summaryIsStale: row.summaryIsStale,
    summary: row.summary,
    summaryUpdatedAt: row.summaryUpdatedAt ? row.summaryUpdatedAt.toISOString() : null,
  };
}

// Explicit pick (not spread): metadata-only projection — bodyJson is
// intentionally absent from the wire shape (callers that need the body
// must use the single-chapter GET endpoint).
export function serializeChapterMeta(row: RepoChapterMeta): ChapterMeta {
  return {
    id: row.id,
    storyId: row.storyId,
    title: row.title,
    wordCount: row.wordCount,
    orderIndex: row.orderIndex,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hasSummary: row.hasSummary,
    summaryIsStale: row.summaryIsStale,
  };
}

// Explicit pick (not spread): RepoDraft's runtime row carries chapterId +
// summaryJsonUpdatedAt remnants; picking keeps the wire shape exact.
// `hasSummary` / `summaryIsStale` are derived here (not on RepoDraft) from the
// decoded `summary` / `summaryUpdatedAt` fields — a corrupt-but-present blob
// decodes to `summary: null` with `summaryUpdatedAt` set, so it still reports
// `hasSummary: true` via the `summaryUpdatedAt !== null` arm.
export function serializeDraft(row: RepoDraft, isActive: boolean): Draft {
  return {
    id: row.id,
    chapterId: row.chapterId,
    label: row.label,
    wordCount: row.wordCount,
    orderIndex: row.orderIndex,
    isActive,
    hasSummary: row.summary !== null || row.summaryUpdatedAt !== null,
    summaryIsStale: row.summaryUpdatedAt !== null && row.summaryUpdatedAt < row.updatedAt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    bodyJson: row.bodyJson,
    summary: row.summary,
    summaryUpdatedAt: row.summaryUpdatedAt ? row.summaryUpdatedAt.toISOString() : null,
  };
}

// Explicit pick (not spread): matches every other serialize* helper.
export function serializeDraftMeta(row: RepoDraftMeta): DraftMeta {
  return {
    id: row.id,
    chapterId: row.chapterId,
    label: row.label,
    wordCount: row.wordCount,
    orderIndex: row.orderIndex,
    isActive: row.isActive,
    hasSummary: row.hasSummary,
    summaryIsStale: row.summaryIsStale,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
