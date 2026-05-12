import type { Character, Message } from 'story-editor-shared';
import type { RepoCharacter } from '../repos/character.repo';
import type { RepoMessage } from '../repos/message.repo';

// Repo-shape input: narrative fields are already plaintext strings (decryption
// happens in the repo), but timestamps are still Date objects from Prisma.
// `Character` (the wire shape) has timestamps as ISO strings. This helper
// converts at the handler boundary so the response matches the schema.
export function serializeCharacter(row: RepoCharacter): Character {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

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
