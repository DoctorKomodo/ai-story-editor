import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * [F43] BYOK Venice key endpoints. The full plaintext key is never returned
 * by the backend — `GET` only echoes back the last six characters of the key
 * (for an at-a-glance "yes that's the right key" check in the Settings UI)
 * plus the endpoint.
 *
 * Endpoints:
 * - `GET    /api/users/me/venice-key`            → status
 * - `PUT    /api/users/me/venice-key`            → store / replace
 * - `DELETE /api/users/me/venice-key`            → remove
 */

export interface VeniceKeyStatus {
  hasKey: boolean;
  lastSix: string | null;
  endpoint: string | null;
}

export interface StoreVeniceKeyInput {
  apiKey: string;
  endpoint?: string;
  organization?: string;
}

export interface StoreVeniceKeyResponse {
  status: 'saved';
  lastSix: string;
  endpoint: string;
}

export const veniceKeyStatusQueryKey = ['venice-key', 'status'] as const;

export function useVeniceKeyStatusQuery(): UseQueryResult<VeniceKeyStatus, Error> {
  return useQuery({
    queryKey: veniceKeyStatusQueryKey,
    queryFn: async (): Promise<VeniceKeyStatus> => {
      return api<VeniceKeyStatus>('/users/me/venice-key');
    },
  });
}

export function useStoreVeniceKeyMutation(): UseMutationResult<
  StoreVeniceKeyResponse,
  Error,
  StoreVeniceKeyInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StoreVeniceKeyInput): Promise<StoreVeniceKeyResponse> => {
      return api<StoreVeniceKeyResponse>('/users/me/venice-key', {
        method: 'PUT',
        body: input,
      });
    },
    onSuccess: (res) => {
      qc.setQueryData<VeniceKeyStatus>(veniceKeyStatusQueryKey, {
        hasKey: true,
        lastSix: res.lastSix,
        endpoint: res.endpoint,
      });
    },
  });
}

export function useDeleteVeniceKeyMutation(): UseMutationResult<void, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await api<void>('/users/me/venice-key', { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.setQueryData<VeniceKeyStatus>(veniceKeyStatusQueryKey, {
        hasKey: false,
        lastSix: null,
        endpoint: null,
      });
    },
  });
}
