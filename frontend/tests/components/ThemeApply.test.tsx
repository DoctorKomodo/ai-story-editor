import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeApply } from '@/components/ThemeApply';
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';
import { useSessionStore } from '@/store/session';

beforeEach(() => {
  useSessionStore.setState({
    user: { id: 'u1', username: 'alice' },
    status: 'authenticated',
  });
});

afterEach(() => {
  useSessionStore.setState({ user: null, status: 'idle' });
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('--prose-font');
  document.documentElement.style.removeProperty('--prose-size');
  document.documentElement.style.removeProperty('--prose-line-height');
});

describe('<ThemeApply />', () => {
  it('mirrors the cached theme onto data-theme on mount (login warm-up path)', () => {
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, { ...DEFAULT_SETTINGS, theme: 'dark' });
    render(
      <QueryClientProvider client={qc}>
        <ThemeApply />
      </QueryClientProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('repaints when settings change in the cache (no need to mount Appearance tab)', async () => {
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, { ...DEFAULT_SETTINGS, theme: 'paper' });
    render(
      <QueryClientProvider client={qc}>
        <ThemeApply />
      </QueryClientProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('paper');

    act(() => {
      qc.setQueryData(userSettingsQueryKey, { ...DEFAULT_SETTINGS, theme: 'sepia' });
    });
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('sepia');
    });
  });

  it('writes the prose-font CSS variable from settings.prose.font', () => {
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, {
      ...DEFAULT_SETTINGS,
      prose: { ...DEFAULT_SETTINGS.prose, font: 'palatino' },
    });
    render(
      <QueryClientProvider client={qc}>
        <ThemeApply />
      </QueryClientProvider>,
    );
    expect(document.documentElement.style.getPropertyValue('--prose-font')).toMatch(/Palatino/);
  });

  it('writes prose-size and prose-line-height CSS variables', () => {
    const qc = new QueryClient();
    qc.setQueryData(userSettingsQueryKey, {
      ...DEFAULT_SETTINGS,
      prose: { font: 'iowan', size: 22, lineHeight: 1.85 },
    });
    render(
      <QueryClientProvider client={qc}>
        <ThemeApply />
      </QueryClientProvider>,
    );
    expect(document.documentElement.style.getPropertyValue('--prose-size')).toBe('22px');
    expect(document.documentElement.style.getPropertyValue('--prose-line-height')).toBe('1.85');
  });

  it('does NOT touch the document when unauthenticated (prevents unguarded fetch on login pages)', () => {
    useSessionStore.setState({ user: null, status: 'unauthenticated' });
    const qc = new QueryClient();
    // Even with stale cached data, no apply should fire.
    qc.setQueryData(userSettingsQueryKey, { ...DEFAULT_SETTINGS, theme: 'dark' });
    render(
      <QueryClientProvider client={qc}>
        <ThemeApply />
      </QueryClientProvider>,
    );
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
