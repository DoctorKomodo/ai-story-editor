import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneCandidateCard } from '@/components/SceneCandidateCard';

describe('SceneCandidateCard', () => {
  let onInsert: ReturnType<typeof vi.fn>;
  let onRetry: ReturnType<typeof vi.fn>;
  let onCopy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onInsert = vi.fn();
    onRetry = vi.fn();
    onCopy = vi.fn();
  });

  function baseProps(overrides: Partial<{ state: 'done' | 'streaming'; isLatest: boolean }> = {}) {
    return {
      direction: 'Jenny approaches Linda.',
      candidate: 'Linda was already at the railing…',
      state: 'done' as const,
      isLatest: true,
      model: 'Llama 3.3 70B',
      onInsert,
      onRetry,
      onCopy,
      ...overrides,
    };
  }

  it('renders direction and candidate text', () => {
    render(<SceneCandidateCard {...baseProps()} />);
    expect(screen.getByText('Jenny approaches Linda.')).toBeInTheDocument();
    expect(screen.getByText(/Linda was already/)).toBeInTheDocument();
  });

  it('shows Insert / Retry / Copy when state="done" and isLatest', async () => {
    const user = userEvent.setup();
    render(<SceneCandidateCard {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /insert at end/i }));
    await user.click(screen.getByRole('button', { name: /retry/i }));
    await user.click(screen.getByRole('button', { name: /copy/i }));
    expect(onInsert).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('hides Retry when not the latest candidate', () => {
    render(<SceneCandidateCard {...baseProps({ isLatest: false })} />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /insert at end/i })).toBeInTheDocument();
    expect(screen.getByText(/superseded/i)).toBeInTheDocument();
  });

  it('shows a streaming indicator without action buttons when state="streaming"', () => {
    render(<SceneCandidateCard {...baseProps({ state: 'streaming' })} />);
    expect(screen.queryByRole('button', { name: /insert/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getByText(/streaming/i)).toBeInTheDocument();
  });

  it('shows the model label in the metadata row', () => {
    render(<SceneCandidateCard {...baseProps()} />);
    expect(screen.getByText('Llama 3.3 70B')).toBeInTheDocument();
  });
});
