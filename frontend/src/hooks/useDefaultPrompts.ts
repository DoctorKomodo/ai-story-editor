// frontend/src/hooks/useDefaultPrompts.ts
//
// [X29] Fetches GET /api/ai/default-prompts — the canonical built-in
// default templates. Cached forever (staleTime: Infinity); constants
// only change on backend deploy. Used by SettingsPromptsTab to render
// the read-only-default + override-checkbox UI.

import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface DefaultPrompts {
  system: string;
  continue: string;
  rewrite: string;
  expand: string;
  summarise: string;
  describe: string;
}

interface DefaultsEnvelope {
  defaults: DefaultPrompts;
}

export const defaultPromptsQueryKey = ['ai-default-prompts'] as const;

export function useDefaultPromptsQuery(): UseQueryResult<DefaultPrompts, Error> {
  return useQuery({
    queryKey: defaultPromptsQueryKey,
    queryFn: async (): Promise<DefaultPrompts> => {
      const res = await api<DefaultsEnvelope>('/ai/default-prompts');
      return res.defaults;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}
