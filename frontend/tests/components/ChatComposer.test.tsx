import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer, type SendArgs } from '@/components/ChatComposer';
import type { Model } from '@/hooks/useModels';
import { DEFAULT_SETTINGS, userSettingsQueryKey } from '@/hooks/useUserSettings';
import { createQueryClient } from '@/lib/queryClient';
import { type AttachedSelectionValue, useAttachedSelectionStore } from '@/store/attachedSelection';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderWithQuery(ui: ReactNode, client?: QueryClient): { client: QueryClient } {
  const qc = client ?? createQueryClient();
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { client: qc };
}

function makeModel(over: Partial<Model> & { id: string }): Model {
  return {
    name: over.id,
    contextLength: 8000,
    supportsReasoning: false,
    supportsVision: false,
    supportsWebSearch: false,
    ...over,
  };
}

const SAMPLE_ATTACHMENT: AttachedSelectionValue = {
  text: 'The candle guttered in the long hallway, throwing shadows that bent like accusations.',
  chapter: {
    id: 'ch-3',
    number: 3,
    title: 'The Long Hallway',
  },
};

describe('ChatComposer (F40)', () => {
  beforeEach(() => {
    useAttachedSelectionStore.setState({ attachedSelection: null });
  });

  afterEach(() => {
    useAttachedSelectionStore.setState({ attachedSelection: null });
  });

  it('renders a textarea with the expected placeholder', () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);
    const textarea = screen.getByPlaceholderText('Ask, rewrite, describe…');
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('Send button has aria-label "Send"', () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('Send button is disabled when value is empty AND no attachment', () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('Send button is enabled when value has text', async () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textarea, 'Hello there');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('Send button is enabled when attachment is set even with empty value', () => {
    useAttachedSelectionStore.setState({ attachedSelection: SAMPLE_ATTACHMENT });
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('typing updates internal value', async () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);
    const textarea = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    await userEvent.type(textarea, 'a story about owls');
    expect(textarea.value).toBe('a story about owls');
  });

  it('Send button click calls onSend with content/attachment/mode', async () => {
    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textarea, 'A question');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    const args = onSend.mock.calls[0]?.[0] as SendArgs;
    expect(args).toEqual({
      content: 'A question',
      attachment: null,
      mode: 'ask',
      enableWebSearch: false,
    });
  });

  it('Cmd+Enter submits', async () => {
    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textarea, 'via meta');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSend).toHaveBeenCalledTimes(1);
    const args = onSend.mock.calls[0]?.[0] as SendArgs;
    expect(args.content).toBe('via meta');
    expect(args.attachment).toBeNull();
    expect(args.mode).toBe('ask');
  });

  it('Ctrl+Enter also submits', async () => {
    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textarea, 'via ctrl');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onSend).toHaveBeenCalledTimes(1);
    const args = onSend.mock.calls[0]?.[0] as SendArgs;
    expect(args.content).toBe('via ctrl');
  });

  it('plain Enter does NOT submit', async () => {
    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textarea, 'no submit{Enter}still typing');
    expect(onSend).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe('no submit\nstill typing');
  });

  it('clears textarea after submit', async () => {
    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} />);
    const textarea = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    await userEvent.type(textarea, 'going away');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(textarea.value).toBe('');
  });

  it('shows attachment block when store is set: caption + quote', () => {
    useAttachedSelectionStore.setState({ attachedSelection: SAMPLE_ATTACHMENT });
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);
    expect(screen.getByTestId('composer-attachment')).toBeInTheDocument();
    expect(screen.getByText('ATTACHED FROM CH. 3')).toBeInTheDocument();
    expect(screen.getByText(SAMPLE_ATTACHMENT.text)).toBeInTheDocument();
  });

  it('attachment block is absent when store is empty', () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);
    expect(screen.queryByTestId('composer-attachment')).toBeNull();
  });

  it('clicking the attachment X clears the store', async () => {
    useAttachedSelectionStore.setState({ attachedSelection: SAMPLE_ATTACHMENT });
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);
    expect(useAttachedSelectionStore.getState().attachedSelection).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear attachment' }));
    expect(useAttachedSelectionStore.getState().attachedSelection).toBeNull();
    expect(screen.queryByTestId('composer-attachment')).toBeNull();
  });

  it('clicking Rewrite mode tab makes it active and submits with mode: rewrite', async () => {
    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} />);

    const askTab = screen.getByRole('tab', { name: 'Ask' });
    const rewriteTab = screen.getByRole('tab', { name: 'Rewrite' });
    const describeTab = screen.getByRole('tab', { name: 'Describe' });

    expect(askTab).toHaveAttribute('aria-selected', 'true');
    expect(rewriteTab).toHaveAttribute('aria-selected', 'false');
    expect(describeTab).toHaveAttribute('aria-selected', 'false');

    await userEvent.click(rewriteTab);
    expect(rewriteTab).toHaveAttribute('aria-selected', 'true');
    expect(askTab).toHaveAttribute('aria-selected', 'false');

    const textarea = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textarea, 'shorter please');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    const args = onSend.mock.calls[0]?.[0] as SendArgs;
    expect(args.mode).toBe('rewrite');
  });

  it('after submit, mode resets to ask', async () => {
    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Describe' }));
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textarea, 'describe it');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByRole('tab', { name: 'Ask' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Describe' })).toHaveAttribute('aria-selected', 'false');
  });

  it('after submit, attachment is cleared from the store', async () => {
    const onSend = vi.fn();
    useAttachedSelectionStore.setState({ attachedSelection: SAMPLE_ATTACHMENT });
    renderWithQuery(<ChatComposer onSend={onSend} />);

    const textarea = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textarea, 'with the attachment');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    const args = onSend.mock.calls[0]?.[0] as SendArgs;
    expect(args.attachment).toEqual(SAMPLE_ATTACHMENT);
    expect(args.content).toBe('with the attachment');

    expect(useAttachedSelectionStore.getState().attachedSelection).toBeNull();
    expect(screen.queryByTestId('composer-attachment')).toBeNull();
  });

  it('disabled prop forces the Send button off even with text', async () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} disabled />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textarea, 'hello');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('does not submit when value is whitespace only AND no attachment', async () => {
    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} />);
    const textarea = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textarea, '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('renders the ⌘↵ send hint', () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);
    expect(screen.getByText('⌘↵ send')).toBeInTheDocument();
  });
});

describe('ChatComposer web-search toggle (F50)', () => {
  function clientWithModel(modelId: string | null): QueryClient {
    const qc = createQueryClient();
    qc.setQueryData(userSettingsQueryKey, {
      ...DEFAULT_SETTINGS,
      chat: { ...DEFAULT_SETTINGS.chat, model: modelId },
    });
    return qc;
  }

  beforeEach(() => {
    useAttachedSelectionStore.setState({ attachedSelection: null });
    vi.spyOn(globalThis, 'fetch').mockImplementation(((url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (u.includes('/api/ai/models')) {
        return Promise.resolve(
          jsonResponse(200, {
            models: [
              makeModel({ id: 'm-search', supportsWebSearch: true }),
              makeModel({ id: 'm-no-search', supportsWebSearch: false }),
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { message: 'not mocked' } }));
    }) as unknown as typeof fetch);
  });

  afterEach(() => {
    useAttachedSelectionStore.setState({ attachedSelection: null });
    vi.restoreAllMocks();
  });

  it('shows the toggle when the selected model supports web search', async () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} />, clientWithModel('m-search'));
    expect(await screen.findByLabelText(/web search/i)).toBeInTheDocument();
  });

  it('hides the toggle when the selected model does not support web search', async () => {
    renderWithQuery(<ChatComposer onSend={vi.fn()} />, clientWithModel('m-no-search'));
    // wait for query to settle, then assert absence
    await screen.findByPlaceholderText('Ask, rewrite, describe…');
    expect(screen.queryByLabelText(/web search/i)).toBeNull();
  });

  it('passes enableWebSearch=true to onSend when checked, then resets', async () => {
    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} />, clientWithModel('m-search'));
    const checkbox = (await screen.findByLabelText(/web search/i)) as HTMLInputElement;
    await userEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    const textarea = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(textarea, 'find me sources');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    const args = onSend.mock.calls[0]?.[0] as SendArgs;
    expect(args.enableWebSearch).toBe(true);

    // Per-turn reset
    expect(checkbox.checked).toBe(false);
  });
});
