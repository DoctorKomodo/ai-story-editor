// [F43] Settings modal — shell + Venice tab. Covers visibility, dialog
// accessibility, tab navigation, footer + close behaviour, and the BYOK
// flow (eye toggle, save / verify / remove, includeVeniceSystemPrompt).
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
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

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

interface DefaultSettingsOptions {
  includeVeniceSystemPrompt?: boolean;
}

function defaultSettings(opts: DefaultSettingsOptions = {}): unknown {
  return {
    settings: {
      theme: 'paper',
      prose: { font: 'serif', size: 18, lineHeight: 1.7 },
      writing: {
        spellcheck: true,
        typewriterMode: false,
        focusMode: false,
        dailyWordGoal: 500,
      },
      chat: { model: null, temperature: 0.7, topP: 1, maxTokens: 1024 },
      ai: {
        includeVeniceSystemPrompt: opts.includeVeniceSystemPrompt ?? true,
      },
    },
  };
}

interface KeyStatusOptions {
  hasKey?: boolean;
  lastFour?: string | null;
  endpoint?: string | null;
}

function keyStatus(opts: KeyStatusOptions = {}): unknown {
  return {
    hasKey: opts.hasKey ?? false,
    lastFour: opts.lastFour ?? null,
    endpoint: opts.endpoint ?? null,
  };
}

/**
 * Route the fetch mock by URL so query-order changes don't break tests.
 * Each handler is a plain function returning a Response (or undefined to
 * fall through to the default).
 */
function routeFetch(
  handlers: Record<string, (init?: RequestInit) => Response | undefined>,
): FetchMock {
  return vi.fn((url: string, init?: RequestInit) => {
    for (const [pattern, handle] of Object.entries(handlers)) {
      if (url === pattern) {
        const res = handle(init);
        if (res) return Promise.resolve(res);
      }
    }
    // Fallback so a missing route doesn't hang a query.
    return Promise.resolve(jsonResponse(200, {}));
  });
}

function renderModal(ui: ReactElement): ReturnType<typeof render> {
  const client = createQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('SettingsModal (F43)', () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    setAccessToken('tok-1');
    setUnauthorizedHandler(() => {
      useSessionStore.getState().clearSession();
    });
    useSessionStore.setState({
      user: { id: 'u1', username: 'alice' },
      status: 'authenticated',
    });
    onClose = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
  });

  it('does not render when open=false', () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': () => jsonResponse(200, keyStatus()),
      }),
    );
    renderModal(<SettingsModal open={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog with title, subtitle, and close X', () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': () => jsonResponse(200, keyStatus()),
      }),
    );
    renderModal(<SettingsModal open onClose={onClose} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeInTheDocument();
    expect(
      screen.getByText(/configure venice\.ai integration, writing preferences/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('settings-close')).toBeInTheDocument();
  });

  it('renders five tabs in order with Venice active by default', () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': () => jsonResponse(200, keyStatus()),
      }),
    );
    renderModal(<SettingsModal open onClose={onClose} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Venice.ai',
      'Models',
      'Prompts',
      'Writing',
      'Appearance',
    ]);
    expect(screen.getByTestId('settings-tab-venice')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('settings-panel-venice')).toBeInTheDocument();
  });

  it('clicking Models flips active state and hides Venice panel', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': () => jsonResponse(200, keyStatus()),
        '/api/ai/models': () => jsonResponse(200, { models: [] }),
      }),
    );
    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);

    await user.click(screen.getByTestId('settings-tab-models'));
    expect(screen.getByTestId('settings-tab-models')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('settings-tab-venice')).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByTestId('venice-section-connection')).toBeNull();
    expect(screen.getByTestId('settings-panel-models')).toBeInTheDocument();
  });

  it('Cancel and Done both call onClose', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': () => jsonResponse(200, keyStatus()),
      }),
    );
    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);

    await user.click(screen.getByTestId('settings-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('settings-done'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('close X calls onClose', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': () => jsonResponse(200, keyStatus()),
      }),
    );
    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);

    await user.click(screen.getByTestId('settings-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape calls onClose', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': () => jsonResponse(200, keyStatus()),
      }),
    );
    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('backdrop click calls onClose', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': () => jsonResponse(200, keyStatus()),
      }),
    );
    const user = userEvent.setup();
    renderModal(<SettingsModal open onClose={onClose} />);

    const backdrop = screen.getByTestId('settings-backdrop');
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  describe('Venice tab', () => {
    it('API key input is type="password" by default; eye toggle flips to text', async () => {
      vi.stubGlobal(
        'fetch',
        routeFetch({
          '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
          '/api/users/me/venice-key': () => jsonResponse(200, keyStatus()),
        }),
      );
      const user = userEvent.setup();
      renderModal(<SettingsModal open onClose={onClose} />);

      const input = screen.getByTestId('venice-key-input');
      expect(input).toHaveAttribute('type', 'password');

      await user.click(screen.getByTestId('venice-key-eye'));
      expect(input).toHaveAttribute('type', 'text');

      await user.click(screen.getByTestId('venice-key-eye'));
      expect(input).toHaveAttribute('type', 'password');
    });

    it('shows last-four indicator when hasKey=true', async () => {
      vi.stubGlobal(
        'fetch',
        routeFetch({
          '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
          '/api/users/me/venice-key': () =>
            jsonResponse(
              200,
              keyStatus({
                hasKey: true,
                lastFour: 'RK7a',
                endpoint: 'https://api.venice.ai/api/v1',
              }),
            ),
        }),
      );
      renderModal(<SettingsModal open onClose={onClose} />);

      const indicator = await screen.findByTestId('venice-key-last-four');
      expect(indicator.textContent).toMatch(/RK7a/);
    });

    it('Save calls PUT /api/users/me/venice-key with the entered key', async () => {
      const fetchMock = routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': (init) => {
          if (!init || init.method == null || init.method === 'GET') {
            return jsonResponse(200, keyStatus());
          }
          if (init.method === 'PUT') {
            return jsonResponse(200, {
              status: 'saved',
              lastFour: 'cdef',
              endpoint: 'https://api.venice.ai/api/v1',
            });
          }
          return undefined;
        },
      });
      vi.stubGlobal('fetch', fetchMock);

      const user = userEvent.setup();
      renderModal(<SettingsModal open onClose={onClose} />);

      // Wait for status query to settle so the Save button reads enabled
      // state cleanly.
      await screen.findByTestId('venice-key-input');

      await user.type(screen.getByTestId('venice-key-input'), 'abc');
      await user.click(screen.getByTestId('venice-key-save'));

      await waitFor(() => {
        const putCall = fetchMock.mock.calls.find(
          ([url, init]: [string, RequestInit | undefined]) =>
            url === '/api/users/me/venice-key' && init?.method === 'PUT',
        );
        expect(putCall).toBeDefined();
        const init = (putCall as [string, RequestInit])[1];
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.apiKey).toBe('abc');
      });
    });

    it('Verify success shows green pill with formatted credits', async () => {
      const fetchMock = routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': (init) => {
          if (!init || init.method == null || init.method === 'GET') {
            return jsonResponse(
              200,
              keyStatus({
                hasKey: true,
                lastFour: 'RK7a',
                endpoint: 'https://api.venice.ai/api/v1',
              }),
            );
          }
          return undefined;
        },
        '/api/users/me/venice-key/verify': () =>
          jsonResponse(200, {
            verified: true,
            credits: 2200,
            diem: null,
            endpoint: 'https://api.venice.ai/api/v1',
            lastFour: 'RK7a',
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const user = userEvent.setup();
      renderModal(<SettingsModal open onClose={onClose} />);

      // Wait for hasKey to flip so Verify is enabled.
      await waitFor(() => {
        expect(screen.getByTestId('venice-key-verify')).not.toBeDisabled();
      });

      await user.click(screen.getByTestId('venice-key-verify'));

      const pill = await screen.findByTestId('venice-key-pill');
      expect(pill).toHaveAttribute('data-pill', 'ok');
      expect(pill.textContent).toMatch(/Verified/);
      expect(pill.textContent).toMatch(/2,200 credits/);
    });

    it('Verify failure shows red pill', async () => {
      const fetchMock = routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': (init) => {
          if (!init || init.method == null || init.method === 'GET') {
            return jsonResponse(
              200,
              keyStatus({
                hasKey: true,
                lastFour: 'RK7a',
                endpoint: 'https://api.venice.ai/api/v1',
              }),
            );
          }
          return undefined;
        },
        '/api/users/me/venice-key/verify': () =>
          jsonResponse(200, {
            verified: false,
            credits: null,
            diem: null,
            endpoint: 'https://api.venice.ai/api/v1',
            lastFour: 'RK7a',
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const user = userEvent.setup();
      renderModal(<SettingsModal open onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByTestId('venice-key-verify')).not.toBeDisabled();
      });

      await user.click(screen.getByTestId('venice-key-verify'));

      const pill = await screen.findByTestId('venice-key-pill');
      expect(pill).toHaveAttribute('data-pill', 'err');
      expect(pill.textContent).toMatch(/Not verified/);
      expect(pill.textContent).toMatch(/RK7a/);
    });

    it('Remove calls DELETE /api/users/me/venice-key', async () => {
      const fetchMock = routeFetch({
        '/api/users/me/settings': () => jsonResponse(200, defaultSettings()),
        '/api/users/me/venice-key': (init) => {
          if (!init || init.method == null || init.method === 'GET') {
            return jsonResponse(
              200,
              keyStatus({
                hasKey: true,
                lastFour: 'RK7a',
                endpoint: 'https://api.venice.ai/api/v1',
              }),
            );
          }
          if (init.method === 'DELETE') {
            return emptyResponse(204);
          }
          return undefined;
        },
      });
      vi.stubGlobal('fetch', fetchMock);

      const user = userEvent.setup();
      renderModal(<SettingsModal open onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByTestId('venice-key-remove')).not.toBeDisabled();
      });

      await user.click(screen.getByTestId('venice-key-remove'));

      await waitFor(() => {
        const deleteCall = fetchMock.mock.calls.find(
          ([url, init]: [string, RequestInit | undefined]) =>
            url === '/api/users/me/venice-key' && init?.method === 'DELETE',
        );
        expect(deleteCall).toBeDefined();
      });
    });

    it('Include Venice creative-writing prompt is checked from settings and PATCHes on toggle', async () => {
      const fetchMock = routeFetch({
        '/api/users/me/settings': (init) => {
          if (!init || init.method == null || init.method === 'GET') {
            return jsonResponse(200, defaultSettings({ includeVeniceSystemPrompt: true }));
          }
          if (init.method === 'PATCH') {
            return jsonResponse(200, defaultSettings({ includeVeniceSystemPrompt: false }));
          }
          return undefined;
        },
        '/api/users/me/venice-key': () => jsonResponse(200, keyStatus()),
      });
      vi.stubGlobal('fetch', fetchMock);

      const user = userEvent.setup();
      renderModal(<SettingsModal open onClose={onClose} />);

      const checkbox = await screen.findByTestId('venice-include-system-prompt');
      // Wait for the settings query to enable the checkbox.
      await waitFor(() => {
        expect(checkbox).not.toBeDisabled();
      });
      expect(checkbox).toBeChecked();

      await user.click(checkbox);

      await waitFor(() => {
        const patchCall = fetchMock.mock.calls.find(
          ([url, init]: [string, RequestInit | undefined]) =>
            url === '/api/users/me/settings' && init?.method === 'PATCH',
        );
        expect(patchCall).toBeDefined();
        const init = (patchCall as [string, RequestInit])[1];
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).toEqual({ ai: { includeVeniceSystemPrompt: false } });
      });
    });
  });
});
