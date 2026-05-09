import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AssistantBubble,
  CitationsSlot,
  CopyAction,
  InsertAtEndAction,
  MessageActions,
  MessageMeta,
  RegenerateAction,
  ThinkingBubble,
} from '@/components/messageRow/primitives';

// modelsQueryKey = ['ai-models'] per useModels.ts
function withQc(node: React.ReactNode, opts: { models?: { id: string; name: string }[] } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (opts.models) {
    qc.setQueryData(['ai-models'], opts.models);
  }
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('AssistantBubble', () => {
  it('renders content with the AI border-left class', () => {
    const { container } = withQc(<AssistantBubble>hello</AssistantBubble>);
    const div = container.querySelector('div');
    expect(div?.className).toContain('border-l-2');
    expect(div?.textContent).toBe('hello');
  });
});

describe('ThinkingBubble', () => {
  it('renders default ThinkingDots without custom label', () => {
    withQc(<ThinkingBubble />);
    // Default label is "Thinking" — no "Generating" text anywhere
    expect(screen.queryByRole('status', { name: /Generating/ })).toBeNull();
  });

  it('renders with custom label', () => {
    withQc(<ThinkingBubble label="Generating scene…" />);
    // ThinkingDots renders aria-label on role="status" span
    expect(screen.getByRole('status', { name: 'Generating scene…' })).toBeInTheDocument();
  });
});

describe('MessageMeta', () => {
  it('renders model name resolved from useModelsQuery', () => {
    withQc(<MessageMeta model="venice-test" tokens={null} latencyMs={null} />, {
      models: [{ id: 'venice-test', name: 'Venice Test 70B' }],
    });
    expect(screen.getByText('Venice Test 70B')).toBeInTheDocument();
  });

  it('falls back to model id when models query has no match', () => {
    withQc(<MessageMeta model="unknown-model" tokens={null} latencyMs={null} />, {
      models: [],
    });
    expect(screen.getByText('unknown-model')).toBeInTheDocument();
  });

  it('renders tokens · latency when both present', () => {
    withQc(<MessageMeta model="m" tokens={412} latencyMs={1800} />, {
      models: [{ id: 'm', name: 'M' }],
    });
    expect(screen.getByText('412 tok · 1.8s')).toBeInTheDocument();
  });

  it('renders nothing if no model and no stats', () => {
    const { container } = withQc(<MessageMeta model={null} tokens={null} latencyMs={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('CopyAction', () => {
  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    withQc(<CopyAction onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('respects disabled', () => {
    const onClick = vi.fn();
    withQc(<CopyAction onClick={onClick} disabled />);
    const btn = screen.getByRole('button', { name: /copy/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('RegenerateAction', () => {
  it('fires onClick when enabled', () => {
    const onClick = vi.fn();
    withQc(<RegenerateAction onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('respects disabled', () => {
    const onClick = vi.fn();
    withQc(<RegenerateAction onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('InsertAtEndAction', () => {
  it('renders "Insert at end" label and fires onClick', () => {
    const onClick = vi.fn();
    withQc(<InsertAtEndAction onClick={onClick} />);
    const btn = screen.getByRole('button', { name: /insert at end/i });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('MessageActions', () => {
  it('wraps children in a flex container', () => {
    const { container } = withQc(
      <MessageActions>
        <button type="button">a</button>
      </MessageActions>,
    );
    expect(container.querySelector('.flex')).toBeTruthy();
  });
});

describe('CitationsSlot', () => {
  it('renders the citations slot wrapper with data attributes regardless of citations', () => {
    const { container } = withQc(<CitationsSlot citations={null} messageId="m-1" />);
    const slot = container.querySelector('[data-citations-slot]');
    expect(slot).toBeTruthy();
    expect(slot?.getAttribute('data-message-id')).toBe('m-1');
  });
});
