// [B11] User settings passthrough.
//
// GET  /api/users/me/settings — read `User.settingsJson`, deep-merged on top of
//                               the project-wide defaults, so a user who's
//                               never written settings gets the full shape.
// PATCH /api/users/me/settings — partial update, Zod-validated (.strict()
//                                everywhere), deep-merged into the stored JSON.
//                                The response echoes the defaults-merged view
//                                so the client never has to replay the merge.
//
// Structural choice: settings are *grouped* (`prose.*`, `writing.*`, `chat.*`,
// `ai.*`) rather than flat (`proseFont`, `proseSize`, ...). The mockup tabs
// (Appearance / Writing / Models) organise controls by group, and
// `chat.routes.ts` already reads `settingsJson.ai.includeVeniceSystemPrompt`
// — the grouped shape is the one the rest of the codebase already speaks.
//
// Defaults for `ai.includeVeniceSystemPrompt` stay aligned with the chat
// route's `resolveIncludeVeniceSystemPrompt` fallback (`true` when absent).

import type { Prisma } from '@prisma/client';
import { type NextFunction, type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { badRequestFromZod } from '../lib/bad-request';
import { deepMerge } from '../lib/deep-merge';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth.middleware';

// ─── Schema ───────────────────────────────────────────────────────────────────

const SettingsSchema = z
  .object({
    theme: z.enum(['paper', 'sepia', 'dark']).optional(),
    prose: z
      .object({
        font: z.string().min(1).max(40).optional(),
        size: z.number().int().min(10).max(32).optional(),
        lineHeight: z.number().min(1).max(3).optional(),
      })
      .strict()
      .optional(),
    writing: z
      .object({
        spellcheck: z.boolean().optional(),
        typewriterMode: z.boolean().optional(),
        focusMode: z.boolean().optional(),
        dailyWordGoal: z.number().int().min(0).max(100_000).optional(),
        // [F66] Typography preferences — read by Paper to gate the
        // matching TipTap input rules.
        smartQuotes: z.boolean().optional(),
        emDashExpansion: z.boolean().optional(),
      })
      .strict()
      .optional(),
    chat: z
      .object({
        model: z.string().min(1).max(200).optional(),
        temperature: z.number().min(0).max(2).optional(),
        topP: z.number().min(0).max(1).optional(),
        maxTokens: z.number().int().min(1).max(32_768).optional(),
      })
      .strict()
      .optional(),
    ai: z
      .object({
        includeVeniceSystemPrompt: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  theme: 'paper' as const,
  prose: { font: 'iowan', size: 18, lineHeight: 1.6 },
  writing: {
    spellcheck: true,
    typewriterMode: false,
    focusMode: false,
    dailyWordGoal: 0,
    smartQuotes: true,
    emDashExpansion: true,
  },
  chat: { model: null as string | null, temperature: 0.85, topP: 0.95, maxTokens: 800 },
  ai: { includeVeniceSystemPrompt: true },
} satisfies Record<string, unknown>;

// ─── Router ───────────────────────────────────────────────────────────────────

export function createUserSettingsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { settingsJson: true },
      });
      const stored =
        user?.settingsJson &&
        typeof user.settingsJson === 'object' &&
        !Array.isArray(user.settingsJson)
          ? (user.settingsJson as Record<string, unknown>)
          : {};
      const merged = deepMerge(DEFAULT_SETTINGS, stored);
      res.status(200).json({ settings: merged });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/', async (req: Request, res: Response, next: NextFunction) => {
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequestFromZod(res, parsed.error);
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { settingsJson: true },
      });
      const stored =
        user?.settingsJson &&
        typeof user.settingsJson === 'object' &&
        !Array.isArray(user.settingsJson)
          ? (user.settingsJson as Record<string, unknown>)
          : {};

      // Merge the validated PATCH payload into whatever is stored, then persist
      // the merged-over-stored value (NOT merged-over-defaults) — we don't want
      // to write the default tree into every user's row on their first PATCH.
      const nextStored = deepMerge(stored, parsed.data as Record<string, unknown>);

      await prisma.user.update({
        where: { id: req.user!.id },
        data: { settingsJson: nextStored as Prisma.InputJsonValue },
      });

      // Response is defaults-merged so the client sees the fully-populated shape.
      res.status(200).json({ settings: deepMerge(DEFAULT_SETTINGS, nextStored) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
