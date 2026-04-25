import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

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
