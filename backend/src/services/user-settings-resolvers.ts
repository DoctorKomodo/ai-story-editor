// Pure resolvers for User.settingsJson — the JSON blob is opaque from the
// Prisma side, so each AI/chat route had been re-deriving the same defensive
// reads from `unknown`. Lifted here so additions (chat.maxTokens in this PR,
// future temperature/topP plumbing) live alongside the existing ones.
//
// Each resolver returns a sane default for unset / non-object / wrong-shape
// inputs so callers can always pass the resolved value into buildPrompt
// without further branching.

export interface PromptsSettings {
  system?: string | null;
  continue?: string | null;
  rewrite?: string | null;
  expand?: string | null;
  summarise?: string | null;
  describe?: string | null;
}

interface UserSettingsShape {
  ai?: { includeVeniceSystemPrompt?: boolean };
  chat?: { maxTokens?: number };
  prompts?: PromptsSettings;
}

function asSettingsObject(raw: unknown): UserSettingsShape | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as UserSettingsShape;
}

export function resolveIncludeVeniceSystemPrompt(raw: unknown): boolean {
  const settings = asSettingsObject(raw);
  if (!settings) return true;
  const flag = settings.ai?.includeVeniceSystemPrompt;
  if (typeof flag === 'boolean') return flag;
  return true;
}

export function resolveUserPrompts(raw: unknown): PromptsSettings {
  const settings = asSettingsObject(raw);
  if (!settings) return {};
  return settings.prompts ?? {};
}

/**
 * Resolves settings.chat.maxTokens to a number suitable for `Math.min` against
 * the model's per-model cap. Unset / non-numeric / non-positive values
 * collapse to Number.POSITIVE_INFINITY so the model cap wins by default.
 */
export function resolveUserMaxCompletionTokens(raw: unknown): number {
  const settings = asSettingsObject(raw);
  if (!settings) return Number.POSITIVE_INFINITY;
  const v = settings.chat?.maxTokens;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return v;
}
