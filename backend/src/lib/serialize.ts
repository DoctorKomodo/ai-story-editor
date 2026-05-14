import type { Character, Message, Story } from 'story-editor-shared';
import type { RepoCharacter } from '../repos/character.repo';
import type { RepoMessage } from '../repos/message.repo';
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
