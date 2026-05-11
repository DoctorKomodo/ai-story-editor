import type { Character } from 'story-editor-shared';

// Repo-shape input: narrative fields are already plaintext strings (decryption
// happens in the repo), but timestamps are still Date objects from Prisma.
// `Character` (the wire shape) has timestamps as ISO strings. This helper
// converts at the handler boundary so the response matches the schema.
//
// The repo's projectDecrypted helper returns `Record<string, unknown>` — we
// accept it here and cast so the route file doesn't need the intermediate
// RepoCharacter type. The respond() egress gate validates the actual shape at
// runtime in non-production, so any drift between the repo output and the wire
// schema surfaces immediately during development.
export function serializeCharacter(row: Record<string, unknown>): Character {
  return {
    ...(row as Omit<Character, 'createdAt' | 'updatedAt'>),
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString(),
  };
}
