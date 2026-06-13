import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Model } from '@/hooks/useModels';
import { api } from '@/lib/api';
import { GLOBAL_TEXT_GEN_DEFAULTS, MAX_OUTPUT_TOKENS_CEILING } from '@/lib/textGenDefaults';
import { useErrorStore } from '@/store/errors';

/**
 * [F43] User-level settings — backed by `GET /api/users/me/settings` and
 * `PATCH /api/users/me/settings` ([B11]). Settings are returned as a single
 * `{ settings: { … } }` envelope; we cache the inner object under
 * `user-settings`.
 *
 * The Venice-system-prompt flag (`ai.includeVeniceSystemPrompt`) is the only
 * field F43 binds today — Models / Writing / Appearance tabs (F44–F46) will
 * consume the rest of the shape via the same hook.
 */

export interface UserProseSettings {
  font: string;
  size: number;
  lineHeight: number;
}

export interface UserWritingSettings {
  spellcheck: boolean;
  typewriterMode: boolean;
  focusMode: boolean;
  dailyWordGoal: number;
  /** [F66] Replace `'` and `"` with curly equivalents in prose. */
  smartQuotes: boolean;
  /** [F66] Replace `--` with `—` (em-dash) on the second hyphen. */
  emDashExpansion: boolean;
}

export interface UserChatOverride {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface UserChatSettings {
  model: string | null;
  overrides: Record<string, UserChatOverride>;
}

export interface UserAiSettings {
  includeVeniceSystemPrompt: boolean;
}

/** [X29] Per-prompt user-level overrides. null = use built-in default. */
export interface UserPromptsSettings {
  system: string | null;
  continue: string | null;
  rewrite: string | null;
  expand: string | null;
  summarise: string | null;
  summariseChapter: string | null;
  describe: string | null;
  scene: string | null;
  ask: string | null;
}

export interface UserSettings {
  theme: 'paper' | 'sepia' | 'dark';
  prose: UserProseSettings;
  writing: UserWritingSettings;
  chat: UserChatSettings;
  ai: UserAiSettings;
  prompts: UserPromptsSettings;
}

interface SettingsEnvelope {
  settings: UserSettings;
}

export const userSettingsQueryKey = ['user-settings'] as const;

export function useUserSettingsQuery(
  options: { enabled?: boolean } = {},
): UseQueryResult<UserSettings, Error> {
  return useQuery({
    queryKey: userSettingsQueryKey,
    queryFn: async (): Promise<UserSettings> => {
      const res = await api<SettingsEnvelope>('/users/me/settings');
      return res.settings;
    },
    enabled: options.enabled,
  });
}

/**
 * Partial update — accepts a deep-partial-ish shape. Values are sent as-is to
 * the backend, which merges them into the stored settings JSON. The query
 * cache is updated on success with the returned settings envelope.
 */
export type UserSettingsPatch = {
  theme?: UserSettings['theme'];
  prose?: Partial<UserProseSettings>;
  writing?: Partial<UserWritingSettings>;
  chat?: Partial<UserChatSettings>;
  ai?: Partial<UserAiSettings>;
  prompts?: Partial<UserPromptsSettings>;
};

export function useUpdateUserSettingsMutation(): UseMutationResult<
  UserSettings,
  Error,
  UserSettingsPatch
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UserSettingsPatch): Promise<UserSettings> => {
      const res = await api<SettingsEnvelope>('/users/me/settings', {
        method: 'PATCH',
        body: patch,
      });
      return res.settings;
    },
    onSuccess: (settings) => {
      qc.setQueryData(userSettingsQueryKey, settings);
    },
  });
}

/**
 * Single canonical default settings for the whole app. Backend defaults at
 * `backend/src/routes/user-settings.routes.ts` are kept in sync with this
 * constant; the round-trip GET tests catch any drift.
 */
export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'paper',
  prose: { font: 'iowan', size: 18, lineHeight: 1.6 },
  writing: {
    spellcheck: true,
    typewriterMode: false,
    focusMode: false,
    dailyWordGoal: 0,
    smartQuotes: true,
    emDashExpansion: true,
  },
  chat: { model: null, overrides: {} },
  ai: { includeVeniceSystemPrompt: true },
  prompts: {
    system: null,
    continue: null,
    rewrite: null,
    expand: null,
    summarise: null,
    summariseChapter: null,
    describe: null,
    scene: null,
    ask: null,
  },
};

/**
 * One-level-deep merge: top-level `theme` is overridden whole; nested groups
 * (`prose`, `writing`, `chat`, `ai`) are merged field-by-field so a partial
 * patch like `{ prose: { font: 'palatino' } }` doesn't clobber `prose.size`.
 */
export function mergeSettings(prev: UserSettings, patch: UserSettingsPatch): UserSettings {
  return {
    theme: patch.theme ?? prev.theme,
    prose: { ...prev.prose, ...(patch.prose ?? {}) },
    writing: { ...prev.writing, ...(patch.writing ?? {}) },
    chat: { ...prev.chat, ...(patch.chat ?? {}) },
    ai: { ...prev.ai, ...(patch.ai ?? {}) },
    prompts: { ...prev.prompts, ...(patch.prompts ?? {}) },
  };
}

/**
 * Read API for settings. Always returns a definite-shape `UserSettings` —
 * defaults fill in while the query is loading or has errored. Consumers
 * don't need to handle the loading state.
 */
export function useUserSettings(): UserSettings {
  const { data } = useUserSettingsQuery();
  return data ?? DEFAULT_SETTINGS;
}

export interface UseUpdateUserSettingResult {
  mutate: (patch: UserSettingsPatch) => void;
  isPending: boolean;
}

/**
 * Write API for settings. Optimistic: snapshots the cache, applies the
 * merged patch synchronously, then PATCHes. On error, restores the
 * snapshot and pushes a `severity:'error'` entry to `useErrorStore` with
 * `source: 'settings.update'` so the dev overlay surfaces the failure.
 *
 * Concurrent mutations: each call snapshots its own pre-state in onError,
 * so a failed mutation rolls back to its own snapshot, not the latest
 * cache value. Acceptable for the rapid-clicks case.
 */
export function useUpdateUserSetting(): UseUpdateUserSettingResult {
  const qc = useQueryClient();
  const mutation = useUpdateUserSettingsMutation();
  return useMemo(
    () => ({
      mutate: (patch: UserSettingsPatch): void => {
        const prev = qc.getQueryData<UserSettings>(userSettingsQueryKey) ?? DEFAULT_SETTINGS;
        qc.setQueryData<UserSettings>(userSettingsQueryKey, mergeSettings(prev, patch));
        mutation.mutate(patch, {
          onError: (err) => {
            qc.setQueryData<UserSettings>(userSettingsQueryKey, prev);
            useErrorStore.getState().push({
              severity: 'error',
              source: 'settings.update',
              code: null,
              message: err instanceof Error ? err.message : 'Failed to save setting.',
              detail: err,
            });
          },
        });
      },
      isPending: mutation.isPending,
    }),
    [mutation, qc],
  );
}

// ---------------------------------------------------------------------------
// resolveChatParams — frontend mirror of backend resolveTextGenParams
// ---------------------------------------------------------------------------

/**
 * Where a resolved parameter value came from.
 *
 * - `'override'`        — the user set a per-model override; the value is used
 *                         as-is (within model limits).
 * - `'override-capped'` — the user's override exceeded the model's
 *                         `maxCompletionTokens` cap; the cap was applied.
 * - `'venice-default'`  — Venice exposes a default for the field on this model;
 *                         no user override exists.
 * - `'global-default'`  — Venice has no default; the app's built-in fallback
 *                         (`GLOBAL_TEXT_GEN_DEFAULTS`) was used.
 */
export type ChatParamSource = 'override' | 'override-capped' | 'venice-default' | 'global-default';

/** Fully resolved chat generation parameters for a specific model + settings pair. */
export interface ResolvedChatParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  /** Indicates the source of each resolved value. Drives UI provenance hints. */
  source: {
    temperature: ChatParamSource;
    topP: ChatParamSource;
    maxTokens: ChatParamSource;
  };
  /**
   * Whether the user has set an explicit per-model override for each field.
   * Drives Reset button enablement: a Reset button should be disabled when
   * `overridden` is all-false.
   */
  overridden: {
    temperature: boolean;
    topP: boolean;
    maxTokens: boolean;
  };
}

/**
 * Resolve effective chat generation parameters for `modelInfo` given the
 * current `settings`.
 *
 * Priority (highest → lowest):
 *   1. User per-model override (settings.chat.overrides[model.id])
 *   2. Venice-supplied model default (model.defaultTemperature / defaultTopP)
 *   3. App global default (GLOBAL_TEXT_GEN_DEFAULTS)
 *
 * For `maxTokens`, the model's `maxCompletionTokens` cap is always enforced:
 * a user override that exceeds the cap is silently clamped to the cap
 * (source becomes `'override-capped'`). When there is no user override, the
 * effective value is `min(cap, MAX_OUTPUT_TOKENS_CEILING)` — source is
 * `'venice-default'` when the model cap binds (cap <= ceiling), `'global-default'`
 * when our ceiling binds (cap > ceiling, the common case for modern models).
 */
export function resolveChatParams(settings: UserSettings, modelInfo: Model): ResolvedChatParams {
  const override = settings.chat.overrides[modelInfo.id] ?? {};

  const tempOverride = typeof override.temperature === 'number';
  const topPOverride = typeof override.topP === 'number';
  const maxOverride = typeof override.maxTokens === 'number';

  const temperature = tempOverride
    ? override.temperature
    : (modelInfo.defaultTemperature ?? GLOBAL_TEXT_GEN_DEFAULTS.temperature);
  const tempSource: ChatParamSource = tempOverride
    ? 'override'
    : modelInfo.defaultTemperature !== null
      ? 'venice-default'
      : 'global-default';

  const topP = topPOverride
    ? override.topP
    : (modelInfo.defaultTopP ?? GLOBAL_TEXT_GEN_DEFAULTS.topP);
  const topPSource: ChatParamSource = topPOverride
    ? 'override'
    : modelInfo.defaultTopP !== null
      ? 'venice-default'
      : 'global-default';

  const cap = modelInfo.maxCompletionTokens;
  let maxTokens: number;
  let maxSource: ChatParamSource;
  if (maxOverride) {
    if ((override.maxTokens as number) > cap) {
      maxTokens = cap;
      maxSource = 'override-capped';
    } else {
      maxTokens = override.maxTokens as number;
      maxSource = 'override';
    }
  } else {
    maxTokens = Math.min(cap, MAX_OUTPUT_TOKENS_CEILING);
    maxSource = cap <= MAX_OUTPUT_TOKENS_CEILING ? 'venice-default' : 'global-default';
  }

  return {
    temperature: temperature as number,
    topP: topP as number,
    maxTokens,
    source: { temperature: tempSource, topP: topPSource, maxTokens: maxSource },
    overridden: { temperature: tempOverride, topP: topPOverride, maxTokens: maxOverride },
  };
}
