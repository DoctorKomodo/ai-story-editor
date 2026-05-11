import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantMessageRow } from '@/components/messageRow/AssistantMessageRow';
import type { ChatMessage } from '@/hooks/useChat';
import { modelsQueryKey } from '@/hooks/useModels';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-a1',
    role: 'assistant',
    contentJson: 'Here is my response.',
    attachmentJson: null,
    citationsJson: null,
    model: 'venice-test',
    tokens: 42,
    latencyMs: 1200,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function withQc(node: React.ReactNode, opts: { models?: { id: string; name: string }[] } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (opts.models) {
    qc.setQueryData(modelsQueryKey, opts.models);
  }
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const MODELS = [{ id: 'venice-test', name: 'Venice Test 70B' }];

describe('AssistantMessageRow', () => {
  it('renders content, meta, and actions slot', () => {
    withQc(
      <AssistantMessageRow message={makeMessage()} actions={<button type="button">Copy</button>} />,
      { models: MODELS },
    );
    expect(screen.getByText('Here is my response.')).toBeInTheDocument();
    // Meta row: model name should appear
    expect(screen.getByText('Venice Test 70B')).toBeInTheDocument();
    // Actions slot
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('renders ThinkingBubble with custom label when isStreaming + empty content + label', () => {
    withQc(
      <AssistantMessageRow
        message={makeMessage({ contentJson: '' })}
        actions={null}
        isStreaming
        thinkingLabel="Generating scene…"
      />,
      { models: MODELS },
    );
    expect(screen.getByRole('status', { name: 'Generating scene…' })).toBeInTheDocument();
  });

  it('renders ThinkingBubble (default) when isStreaming + empty content + no label, and AI border-left class present', () => {
    const { container } = withQc(
      <AssistantMessageRow message={makeMessage({ contentJson: '' })} actions={null} isStreaming />,
      { models: MODELS },
    );
    // ThinkingBubble is rendered (default label)
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    // AI border-left class on the ThinkingBubble wrapper
    const borderEl = container.querySelector('.border-l-2.border-\\[var\\(--ai\\)\\]');
    expect(borderEl).toBeTruthy();
  });

  it('renders regular AssistantBubble (not thinking) when content empty but isStreaming is false', () => {
    withQc(<AssistantMessageRow message={makeMessage({ contentJson: '' })} actions={null} />, {
      models: MODELS,
    });
    // Should NOT render a status/thinking element
    expect(screen.queryByRole('status')).toBeNull();
    // Should render the AssistantBubble (even though text is empty)
    const li = screen.getByTestId('assistant-msg-a1');
    expect(li).toBeInTheDocument();
  });

  it('renders bubble (not thinking) when isStreaming + non-empty content — transition state', () => {
    withQc(
      <AssistantMessageRow
        message={makeMessage({ contentJson: 'Partial text…' })}
        actions={null}
        isStreaming
      />,
      { models: MODELS },
    );
    // Non-empty content takes precedence over isStreaming
    expect(screen.getByText('Partial text…')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('mounts CitationsSlot with the message id', () => {
    const { container } = withQc(
      <AssistantMessageRow
        message={makeMessage({ id: 'msg-cit-1', citationsJson: null })}
        actions={null}
      />,
      { models: MODELS },
    );
    const slot = container.querySelector('[data-citations-slot]');
    expect(slot).toBeTruthy();
    expect(slot?.getAttribute('data-message-id')).toBe('msg-cit-1');
  });
});
