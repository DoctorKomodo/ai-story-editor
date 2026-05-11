import type { Character } from 'story-editor-shared';

// Repo-shape input: narrative fields are already plaintext strings (decryption
// happens in the repo), but timestamps are still Date objects from Prisma.
// `Character` (the wire shape) has timestamps as ISO strings. This helper
// converts at the handler boundary so the response matches the schema.
type RepoCharacter = Omit<Character, 'createdAt' | 'updatedAt'> & {
  createdAt: Date;
  updatedAt: Date;
};

export function serializeCharacter(row: RepoCharacter): Character {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
