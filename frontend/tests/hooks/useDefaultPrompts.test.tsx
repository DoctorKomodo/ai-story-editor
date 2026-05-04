// frontend/tests/hooks/useDefaultPrompts.test.tsx
//
// [X29] useDefaultPromptsQuery — fetches GET /api/ai/default-prompts and
// caches with staleTime: Infinity. Used by SettingsPromptsTab to render
// the read-only-default + override-checkbox UI.

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDefaultPromptsQuery } from '@/hooks/useDefaultPrompts';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';

const mockDefaults = {
  system: 'Default system text.',
  continue: 'Default continue.',
  rewrite: 'Default rewrite.',
  expand: 'Default expand.',
  summarise: 'Default summarise.',
  describe: 'Default describe.',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  resetApiClientForTests();
  setAccessToken('test-token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/ai/default-prompts')) {
        return jsonResponse({ defaults: mockDefaults });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetApiClientForTests();
});

describe('[X29] useDefaultPromptsQuery', () => {
  it('returns defaults from /api/ai/default-prompts', async () => {
    const qc = createQueryClient();
    const { result } = renderHook(() => useDefaultPromptsQuery(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.data).toEqual(mockDefaults));
  });
});
