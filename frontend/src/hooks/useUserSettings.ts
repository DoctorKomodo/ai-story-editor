import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '@/lib/api';
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

export interface UserChatSettings {
  model: string | null;
  temperature: number;
  topP: number;
  maxTokens: number;
}

export interface UserAiSettings {
  includeVeniceSystemPrompt: boolean;
}

export interface UserSettings {
  theme: 'paper' | 'sepia' | 'dark';
  prose: UserProseSettings;
  writing: UserWritingSettings;
  chat: UserChatSettings;
  ai: UserAiSettings;
}

interface SettingsEnvelope {
  settings: UserSettings;
}

export const userSettingsQueryKey = ['user-settings'] as const;

export function useUserSettingsQuery(): UseQueryResult<UserSettings, Error> {
  return useQuery({
    queryKey: userSettingsQueryKey,
    queryFn: async (): Promise<UserSettings> => {
      const res = await api<SettingsEnvelope>('/users/me/settings');
      return res.settings;
    },
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
  chat: { model: null, temperature: 0.85, topP: 0.95, maxTokens: 800 },
  ai: { includeVeniceSystemPrompt: true },
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
