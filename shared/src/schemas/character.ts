import { z } from 'zod';

// `z.strictObject` rejects unknown keys at every layer. Strictness is
// preserved through `.partial()` / `.omit()` / etc. — this is the
// load-bearing invariant that closes the Prisma↔Zod drift seam at
// egress validation time.
export const characterSchema = z.strictObject({
  id: z.string().min(1),
  storyId: z.string().min(1),
  name: z.string(),
  role: z.string().nullable(),
  age: z.string().nullable(),
  appearance: z.string().nullable(),
  personality: z.string().nullable(),
  voice: z.string().nullable(),
  backstory: z.string().nullable(),
  arc: z.string().nullable(),
  relationships: z.string().nullable(),
  orderIndex: z.number().int().nonnegative(),
  color: z.string().nullable(),
  initial: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const characterCreateSchema = z.strictObject({
  name: z.string().min(1),
  role: z.string().nullable().optional(),
  age: z.string().nullable().optional(),
  appearance: z.string().nullable().optional(),
  personality: z.string().nullable().optional(),
  voice: z.string().nullable().optional(),
  backstory: z.string().nullable().optional(),
  arc: z.string().nullable().optional(),
  relationships: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  initial: z.string().nullable().optional(),
});

export const characterUpdateSchema = characterCreateSchema.partial();

export const characterResponseSchema = z.strictObject({ character: characterSchema });
export const charactersResponseSchema = z.strictObject({
  characters: z.array(characterSchema),
});

export const characterReorderSchema = z.strictObject({
  characters: z.array(
    z.strictObject({
      id: z.string().min(1),
      orderIndex: z.number().int().nonnegative(),
    }),
  ),
});

export type Character = z.infer<typeof characterSchema>;
export type CharacterCreateInput = z.infer<typeof characterCreateSchema>;
export type CharacterUpdateInput = z.infer<typeof characterUpdateSchema>;

// Canonical roster of Character's narrative content fields. The tuple is the
// single source of truth — adding a field here propagates to:
// - `CharacterPromptInput` (via Pick)
// - `toCharacterPromptInput` (via the loop)
// - `character.repo.ts`'s ENCRYPTED_FIELDS (imported from here)
// The Zod schema (`characterSchema`) still has to add the field separately —
// that's deliberate (different shape per field: nullable/optional, validators)
// and is checked at compile time when `Pick<Character, NarrativeFieldKey>`
// would fail if the schema didn't include the key.
export const NARRATIVE_FIELD_KEYS = [
  'name',
  'role',
  'age',
  'appearance',
  'personality',
  'voice',
  'backstory',
  'arc',
  'relationships',
] as const;
export type NarrativeFieldKey = (typeof NARRATIVE_FIELD_KEYS)[number];

// Narrow projection consumed by the prompt builder. Derived from Character
// so it cannot drift; drops structural and timestamp fields that the
// prompt builder doesn't read (and that `id` / `storyId` would be leak
// risks if a future contributor interpolated them into a template).
export type CharacterPromptInput = Pick<Character, NarrativeFieldKey>;

// Helper for routes that have a Character-shaped value and need the
// narrow projection. Accepts the structural subset so repo outputs with
// `Date` timestamps still type-check at the call site — timestamps are
// not read.
export function toCharacterPromptInput(c: CharacterPromptInput): CharacterPromptInput {
  return Object.fromEntries(
    NARRATIVE_FIELD_KEYS.map((k) => [k, c[k]] as const),
  ) as CharacterPromptInput;
}
