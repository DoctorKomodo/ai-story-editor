import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelSelector } from '@/components/ModelSelector';
import { useSelectedModel } from '@/hooks/useSelectedModel';
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

interface RenderResult {
  client: QueryClient;
}

function renderWithProviders(ui: ReactNode, client?: QueryClient): RenderResult {
  const qc = client ?? createQueryClient();
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { client: qc };
}

const THREE_MODELS = {
  models: [
    {
      id: 'venice-uncensored',
      name: 'Venice Uncensored',
      contextLength: 32768,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: false,
    },
    {
      id: 'llama-3.3-70b',
      name: 'Llama 3.3 70B',
      contextLength: 128000,
      supportsReasoning: false,
      supportsVision: false,
      supportsWebSearch: false,
    },
    {
      id: 'deepseek-r1',
      name: 'DeepSeek R1',
      contextLength: 64000,
      supportsReasoning: true,
      supportsVision: false,
      supportsWebSearch: false,
    },
  ],
};

describe('ModelSelector (F13)', () => {
  let fetchMock: FetchMock;

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
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    resetApiClientForTests();
    useSessionStore.setState({ user: null, status: 'idle' });
    localStorage.clear();
  });

  it('renders loading status while fetch is pending', async () => {
    let resolveFetch: ((res: Response) => void) | null = null;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/ai/models')) return pending;
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderWithProviders(<ModelSelector value={null} onChange={vi.fn()} />);

    const status = await screen.findByRole('status');
    expect(status.textContent ?? '').toMatch(/loading models/i);

    resolveFetch?.(jsonResponse(200, { models: [] }));
  });

  it('renders two optgroups (Reasoning and Standard) with the reasoning model in Reasoning', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/ai/models')) {
        return Promise.resolve(jsonResponse(200, THREE_MODELS));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderWithProviders(<ModelSelector value="venice-uncensored" onChange={vi.fn()} />);

    const select = (await screen.findByRole('combobox', { name: 'Model' })) as HTMLSelectElement;
    const groups = select.querySelectorAll('optgroup');
    expect(groups).toHaveLength(2);
    const reasoningGroup = Array.from(groups).find((g) => g.label === 'Reasoning');
    const standardGroup = Array.from(groups).find((g) => g.label === 'Standard');
    expect(reasoningGroup).toBeDefined();
    expect(standardGroup).toBeDefined();

    // Reasoning group contains the reasoning model.
    const reasoningOptions = within(reasoningGroup as HTMLElement).getAllByRole('option');
    expect(reasoningOptions).toHaveLength(1);
    expect(reasoningOptions[0]?.textContent).toMatch(/DeepSeek R1/);

    // Standard group contains the two non-reasoning models.
    const standardOptions = within(standardGroup as HTMLElement).getAllByRole('option');
    expect(standardOptions).toHaveLength(2);
    expect(standardOptions[0]?.textContent).toMatch(/Venice Uncensored/);
    expect(standardOptions[1]?.textContent).toMatch(/Llama 3\.3 70B/);
  });

  it('option labels include the context-length suffix', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/ai/models')) {
        return Promise.resolve(jsonResponse(200, THREE_MODELS));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderWithProviders(<ModelSelector value="venice-uncensored" onChange={vi.fn()} />);

    await screen.findByRole('combobox', { name: 'Model' });
    // 128000 / 1024 ≈ 125
    expect(screen.getByRole('option', { name: 'Llama 3.3 70B · 125K' })).toBeInTheDocument();
    // 32768 / 1024 = 32
    expect(screen.getByRole('option', { name: 'Venice Uncensored · 32K' })).toBeInTheDocument();
    // 64000 / 1024 ≈ 63
    expect(screen.getByRole('option', { name: 'DeepSeek R1 · 63K' })).toBeInTheDocument();
  });

  it('renders role="alert" with venice_key_required copy on 409', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/ai/models')) {
        return Promise.resolve(
          jsonResponse(409, {
            error: { message: 'Venice key required', code: 'venice_key_required' },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderWithProviders(<ModelSelector value={null} onChange={vi.fn()} />);

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert.textContent ?? '').toMatch(/add a venice api key in settings/i);
  });

  it('auto-selects the first model when value is null and models load', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/ai/models')) {
        return Promise.resolve(jsonResponse(200, THREE_MODELS));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onChange = vi.fn();
    renderWithProviders(<ModelSelector value={null} onChange={onChange} />);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('venice-uncensored');
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('fires onChange with the new id when the select value changes', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/ai/models')) {
        return Promise.resolve(jsonResponse(200, THREE_MODELS));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const onChange = vi.fn();
    renderWithProviders(<ModelSelector value="venice-uncensored" onChange={onChange} />);

    const select = (await screen.findByRole('combobox', { name: 'Model' })) as HTMLSelectElement;
    await userEvent.selectOptions(select, 'llama-3.3-70b');

    expect(onChange).toHaveBeenCalledWith('llama-3.3-70b');
  });

  it('useSelectedModel persists the chosen id across remounts via localStorage', () => {
    const first = renderHook(() => useSelectedModel());
    expect(first.result.current.selectedModelId).toBeNull();
    act(() => {
      first.result.current.setSelectedModelId('deepseek-r1');
    });
    expect(first.result.current.selectedModelId).toBe('deepseek-r1');
    expect(localStorage.getItem('inkwell:selectedModelId')).toBe('deepseek-r1');
    first.unmount();

    const second = renderHook(() => useSelectedModel());
    expect(second.result.current.selectedModelId).toBe('deepseek-r1');
    second.unmount();
  });
});
