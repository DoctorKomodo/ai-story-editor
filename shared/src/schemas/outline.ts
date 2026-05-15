import { z } from 'zod';

// Field-length caps — single source of truth, exported so future `OutlineModal`
// (filed as story-editor-syb) imports them instead of re-declaring the numbers.
// Values copied verbatim from the legacy inline schemas in outline.routes.ts.
export const OUTLINE_TITLE_MAX = 300;
export const OUTLINE_SUB_MAX = 2000;
export const OUTLINE_STATUS_MAX = 40;

// `z.strictObject` rejects unknown keys at every layer — the load-bearing
// invariant that closes the Prisma↔Zod drift seam at egress-validation time,
// same as character.ts / message.ts / story.ts.
export const outlineItemSchema = z.strictObject({
  id: z.string().min(1),
  storyId: z.string().min(1),
  title: z.string(),
  sub: z.string().nullable(),
  // `status` stays free-form: the DB column is plain `String`, no Prisma enum,
  // no server-enforced contract. The frontend convention 'queued'|'active'|'done'
  // lives in useOutline.ts as a UI rendering type alias and is intentionally
  // NOT exported from this package.
  status: z.string(),
  order: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// POST body — `order` is NOT settable here (the route auto-allocates via
// maxOrder + retry, guarded by @@unique([storyId, order])). `storyId` comes
// from the URL, not the body.
export const outlineCreateSchema = z.strictObject({
  title: z.string().min(1).max(OUTLINE_TITLE_MAX),
  sub: z.string().max(OUTLINE_SUB_MAX).nullable().optional(),
  status: z.string().min(1).max(OUTLINE_STATUS_MAX),
});

// PATCH body — every create field optional + `order` settable for per-item
// repositioning (bulk reorder goes through outlineReorderSchema). First
// migrated entity to use .partial().extend(...). In Zod 4 (the project's
// pinned version) both `.partial()` and `.extend()` on a strictObject preserve
// strictness, so unknown keys are still rejected on PATCH.
export const outlineUpdateSchema = outlineCreateSchema.partial().extend({
  order: z.number().int().nonnegative().optional(),
});

// PATCH /reorder body — semantic duplicate-id / duplicate-order checks live
// in the route (the error contract returns a per-failure human message that
// Zod's default .refine() formatting can't preserve cleanly). max(500) matches
// today's inline ReorderOutlineBody.
export const outlineReorderSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        order: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
});

export const outlineItemResponseSchema = z.strictObject({ outlineItem: outlineItemSchema });
export const outlineListResponseSchema = z.strictObject({ outline: z.array(outlineItemSchema) });

// Single source of truth for which OutlineItem fields are encrypted at rest.
// Imported by backend/src/repos/outline.repo.ts as ENCRYPTED_FIELDS. Repo-only
// consumer, but the tuple belongs beside the schema describing the same entity
// (matches the STORY / MESSAGE pattern).
export const OUTLINE_ENCRYPTED_FIELD_KEYS = ['title', 'sub'] as const;

export type OutlineItem = z.infer<typeof outlineItemSchema>;
export type OutlineCreateInput = z.infer<typeof outlineCreateSchema>;
export type OutlineUpdateInput = z.infer<typeof outlineUpdateSchema>;
export type OutlineReorderInput = z.infer<typeof outlineReorderSchema>;
export type OutlineEncryptedFieldKey = (typeof OUTLINE_ENCRYPTED_FIELD_KEYS)[number];
