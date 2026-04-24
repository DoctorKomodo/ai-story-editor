/**
 * [F17] TanStack Query hook for the user's Venice account balance.
 *
 * Backend contract (V10): `GET /api/ai/balance` returns
 * `{ credits: number | null, diem: number | null }`. Either field may be
 * null when Venice's upstream response didn't emit the corresponding
 * header. 409 `venice_key_required` is raised when the user has no BYOK
 * key stored.
 *
 * Balance is fetched eagerly on editor load per the F17 task text; the
 * `enabled` flag exists so future surfaces (pages that don't need it) can
 * opt out without duplicating the query definition.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Balance {
  credits: number | null;
  diem: number | null;
}

export const balanceQueryKey = ['ai-balance'] as const;

export function useBalanceQuery(enabled = true): UseQueryResult<Balance, Error> {
  return useQuery<Balance, Error>({
    queryKey: balanceQueryKey,
    queryFn: async (): Promise<Balance> => {
      return api<Balance>('/ai/balance');
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled,
  });
}
