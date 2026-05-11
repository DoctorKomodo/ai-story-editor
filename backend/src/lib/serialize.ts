import type { Character } from 'story-editor-shared';
import type { RepoCharacter } from '../repos/character.repo';

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
