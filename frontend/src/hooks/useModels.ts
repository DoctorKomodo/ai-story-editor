/**
 * [F13] TanStack Query hook for Venice model metadata.
 *
 * Shape mirrors the backend's `ModelInfo`
 * (`backend/src/services/venice.models.service.ts`). The list is used by
 * `<ModelSelector />` to drive the AI panel's model dropdown.
 *
 * Follow-ups:
 * - [F15] consumes the selected model id when calling `/api/ai/complete`.
 * - [F42] redesigns the picker to the mockup spec (custom popover, grouping).
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Model {
  id: string;
  name: string;
  contextLength: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  supportsWebSearch: boolean;
}

export interface ModelsResponse {
  models: Model[];
}

export const modelsQueryKey = ['ai-models'] as const;

/**
 * Fetches the user's available Venice models. Backend caches upstream for
 * 10 minutes; we mirror that staleTime so a user re-opening the picker does
 * not re-hit the network unnecessarily.
 *
 * The query is enabled unconditionally — a 409 `venice_key_required` surfaces
 * as an `ApiError` which `<ModelSelector />` renders with its own copy.
 */
export function useModelsQuery(): UseQueryResult<Model[], Error> {
  return useQuery<Model[], Error>({
    queryKey: modelsQueryKey,
    queryFn: async (): Promise<Model[]> => {
      const res = await api<ModelsResponse>('/ai/models');
      return res.models;
    },
    staleTime: 10 * 60 * 1000,
  });
}
