import { z } from 'zod';

// `z.strictObject` rejects unknown keys at every layer. Strictness is
// preserved through `.partial()` / `.omit()` / etc. — this is the
// load-bearing invariant that closes the Prisma↔Zod drift seam at
// egress validation time.
export const characterSchema = z.strictObject({
  id: z.string().uuid(),
  storyId: z.string().uuid(),
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
      id: z.string().uuid(),
      orderIndex: z.number().int().nonnegative(),
    }),
  ),
});

export type Character = z.infer<typeof characterSchema>;
export type CharacterCreateInput = z.infer<typeof characterCreateSchema>;
export type CharacterUpdateInput = z.infer<typeof characterUpdateSchema>;
