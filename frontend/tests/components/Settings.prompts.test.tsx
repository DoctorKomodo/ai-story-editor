// frontend/tests/components/Settings.prompts.test.tsx
//
// [X29] Settings → Prompts tab.
// Covers:
//   - Default state: every row read-only, checkbox unchecked, default
//     text from /api/ai/default-prompts visible.
//   - Tick checkbox → field becomes editable, seeded with default;
//     PATCH /users/me/settings { prompts: { <key>: <default text> } } fires.
//   - Edit + blur → PATCH with the new value.
//   - Untick checkbox → PATCH with null; field reverts to read-only default.
//   - rewrite row label mentions both surfaces.

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '@/components/Settings';
import { resetApiClientForTests, setAccessToken, setUnauthorizedHandler } from '@/lib/api';
import { createQueryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/store/session';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const DEFAULTS = {
  system: 'You are an expert creative-writing assistant. (default)',
  continue: 'Task: continue (default).',
  rewrite: 'Task: rewrite (default).',
  expand: 'Task: expand (default).',
  summarise: 'Task: summarise (default).',
  describe: 'Task: describe (default).',
};

interface SettingsState {
  theme: 'paper' | 'sepia' | 'dark';
  prose: { font: string; size: number; lineHeight: number };
  writing: {
    spellcheck: boolean;
    typewriterMode: boolean;
    focusMode: boolean;
    dailyWordGoal: number;
    smartQuotes: boolean;
    emDashExpansion: boolean;
  };
  chat: { model: string | null; temperature: number; topP: number; maxTokens: number };
  ai: { includeVeniceSystemPrompt: boolean };
  prompts: {
    system: string | null;
    continue: string | null;
    rewrite: string | null;
    expand: string | null;
    summarise: string | null;
    describe: string | null;
  };
}

function makeSettings(prompts: Partial<SettingsState['prompts']> = {}): SettingsState {
  return {
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
    prompts: {
      system: null,
      continue: null,
      rewrite: null,
      expand: null,
      summarise: null,
      describe: null,
      ...prompts,
    },
  };
}

let fetchMock: FetchMock;
let lastPatchBody: unknown = null;

function installFetch(initialSettings: SettingsState): void {
  let current = initialSettings;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url.endsWith('/api/users/me/settings') && method === 'GET') {
      return jsonResponse(200, { settings: current });
    }
    if (url.endsWith('/api/users/me/settings') && method === 'PATCH') {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      lastPatchBody = body;
      current = {
        ...current,
        prompts: { ...current.prompts, ...(body.prompts ?? {}) },
      };
      return jsonResponse(200, { settings: current });
    }
    if (url.endsWith('/api/ai/default-prompts') && method === 'GET') {
      return jsonResponse(200, { defaults: DEFAULTS });
    }
    if (url.endsWith('/api/users/me/venice-key') && method === 'GET') {
      return jsonResponse(200, { hasKey: false, lastFour: null, endpoint: null });
    }
    // Default no-op so an unmocked endpoint doesn't hang a query.
    return jsonResponse(200, {});
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderModal(): { qc: ReturnType<typeof createQueryClient> } {
  const qc = createQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <SettingsModal open onClose={() => {}} />
    </QueryClientProvider>,
  );
  return { qc };
}

beforeEach(() => {
  resetApiClientForTests();
  setAccessToken('test-token');
  setUnauthorizedHandler(() => {
    useSessionStore.getState().clearSession();
  });
  useSessionStore.setState({
    user: { id: 'u1', username: 'alice' },
    status: 'authenticated',
  });
  lastPatchBody = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  resetApiClientForTests();
  useSessionStore.setState({ user: null, status: 'idle' });
});

async function openPromptsTab(): Promise<void> {
  const tab = await screen.findByTestId('settings-tab-prompts');
  await userEvent.click(tab);
}

describe('[X29] SettingsPromptsTab', () => {
  it('default state — every row shows the default read-only with checkbox unchecked', async () => {
    installFetch(makeSettings());
    renderModal();
    await openPromptsTab();

    await waitFor(() => screen.getByTestId('prompts-row-system'));
    expect(screen.getByTestId('prompts-default-system')).toHaveTextContent(DEFAULTS.system);
    expect(screen.getByTestId('prompts-toggle-system')).not.toBeChecked();
    for (const key of ['continue', 'rewrite', 'expand', 'summarise', 'describe']) {
      expect(screen.getByTestId(`prompts-default-${key}`)).toHaveTextContent(
        DEFAULTS[key as keyof typeof DEFAULTS],
      );
      expect(screen.getByTestId(`prompts-toggle-${key}`)).not.toBeChecked();
    }
  });

  it('ticking checkbox PATCHes with the default text and reveals an editable field', async () => {
    installFetch(makeSettings());
    renderModal();
    await openPromptsTab();

    const toggle = await screen.findByTestId('prompts-toggle-continue');
    await userEvent.click(toggle);

    await waitFor(() => {
      const body = lastPatchBody as { prompts?: { continue?: string | null } } | null;
      expect(body?.prompts?.continue).toBe(DEFAULTS.continue);
    });

    const editable = await screen.findByTestId('prompts-editor-continue');
    expect(editable).toHaveValue(DEFAULTS.continue);
    expect(editable).not.toHaveAttribute('readonly');
  });

  it('editing + blurring PATCHes the new value', async () => {
    installFetch(makeSettings({ continue: DEFAULTS.continue }));
    renderModal();
    await openPromptsTab();

    const editable = await screen.findByTestId('prompts-editor-continue');
    await userEvent.clear(editable);
    await userEvent.type(editable, 'Custom continue text.');
    fireEvent.blur(editable);

    await waitFor(() => {
      const body = lastPatchBody as { prompts?: { continue?: string | null } } | null;
      expect(body?.prompts?.continue).toBe('Custom continue text.');
    });
  });

  it('unticking PATCHes null and reverts the row to read-only default', async () => {
    installFetch(makeSettings({ continue: 'Custom value.' }));
    renderModal();
    await openPromptsTab();

    const toggle = await screen.findByTestId('prompts-toggle-continue');
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);

    await waitFor(() => {
      const body = lastPatchBody as { prompts?: { continue?: string | null } } | null;
      expect(body?.prompts?.continue).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('prompts-default-continue')).toHaveTextContent(DEFAULTS.continue);
    });
  });

  it('rewrite row label calls out both surfaces', async () => {
    installFetch(makeSettings());
    renderModal();
    await openPromptsTab();

    const row = await screen.findByTestId('prompts-row-rewrite');
    expect(row).toHaveTextContent(/rephrase/i);
    expect(row).toHaveTextContent(/selection bubble|AI panel|both/i);
  });
});
