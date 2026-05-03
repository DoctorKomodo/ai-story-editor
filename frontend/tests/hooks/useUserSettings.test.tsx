import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type UserSettings,
  userSettingsQueryKey,
  useUpdateUserSetting,
  useUserSettings,
} from '@/hooks/useUserSettings';
import { resetApiClientForTests, setAccessToken } from '@/lib/api';
import { useErrorStore } from '@/store/errors';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeWrapper(qc: QueryClient): (props: { children: ReactNode }) => JSX.Element {
  return function Wrapper({ children }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('mergeSettings', () => {
  it('returns prev unchanged when patch is empty', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {});
    expect(merged).toEqual(DEFAULT_SETTINGS);
  });

  it('overrides top-level theme', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { theme: 'dark' });
    expect(merged.theme).toBe('dark');
    expect(merged.prose).toEqual(DEFAULT_SETTINGS.prose);
  });

  it('one-level-merges nested groups (prose.font without losing prose.size)', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { prose: { font: 'palatino' } });
    expect(merged.prose.font).toBe('palatino');
    expect(merged.prose.size).toBe(DEFAULT_SETTINGS.prose.size);
    expect(merged.prose.lineHeight).toBe(DEFAULT_SETTINGS.prose.lineHeight);
  });

  it('one-level-merges chat (model only without losing temperature/topP/maxTokens)', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { chat: { model: 'venice-uncensored' } });
    expect(merged.chat.model).toBe('venice-uncensored');
    expect(merged.chat.temperature).toBe(DEFAULT_SETTINGS.chat.temperature);
    expect(merged.chat.topP).toBe(DEFAULT_SETTINGS.chat.topP);
    expect(merged.chat.maxTokens).toBe(DEFAULT_SETTINGS.chat.maxTokens);
  });

  it('one-level-merges writing (spellcheck without losing other writing flags)', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { writing: { spellcheck: false } });
    expect(merged.writing.spellcheck).toBe(false);
    expect(merged.writing.smartQuotes).toBe(DEFAULT_SETTINGS.writing.smartQuotes);
  });

  it('one-level-merges ai', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { ai: { includeVeniceSystemPrompt: false } });
    expect(merged.ai.includeVeniceSystemPrompt).toBe(false);
  });
});

describe('useUserSettings', () => {
  it('returns DEFAULT_SETTINGS while loading', () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useUserSettings(), { wrapper: makeWrapper(qc) });
    expect(result.current).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the cached settings once the query resolves', () => {
    const fakeSettings: UserSettings = {
      ...DEFAULT_SETTINGS,
      theme: 'sepia',
      chat: { ...DEFAULT_SETTINGS.chat, model: 'venice-uncensored' },
    };
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, fakeSettings);
    const { result } = renderHook(() => useUserSettings(), { wrapper: makeWrapper(qc) });
    expect(result.current.theme).toBe('sepia');
    expect(result.current.chat.model).toBe('venice-uncensored');
  });
});

describe('useUpdateUserSetting', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    act(() => {
      useErrorStore.getState().clear();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
    act(() => {
      useErrorStore.getState().clear();
    });
  });

  it('optimistically updates the cache before the PATCH resolves', () => {
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { settings: { ...DEFAULT_SETTINGS, theme: 'dark' } }),
    );
    const { result } = renderHook(() => useUpdateUserSetting(), { wrapper: makeWrapper(qc) });
    act(() => {
      result.current.mutate({ theme: 'dark' });
    });
    expect(qc.getQueryData<UserSettings>(userSettingsQueryKey)?.theme).toBe('dark');
  });

  it('rolls back the cache + publishes to useErrorStore on PATCH failure', async () => {
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, DEFAULT_SETTINGS);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: { message: 'boom', code: 'internal_error' } }),
    );
    const { result } = renderHook(() => useUpdateUserSetting(), { wrapper: makeWrapper(qc) });
    act(() => {
      result.current.mutate({ theme: 'dark' });
    });
    await waitFor(() => {
      expect(useErrorStore.getState().errors).toHaveLength(1);
    });
    expect(qc.getQueryData<UserSettings>(userSettingsQueryKey)?.theme).toBe('paper');
    expect(useErrorStore.getState().errors[0].source).toBe('settings.update');
  });
});
