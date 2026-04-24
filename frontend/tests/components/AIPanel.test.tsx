import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AIPanel } from '@/components/AIPanel';

describe('AIPanel (F12)', () => {
  it('renders all four action buttons with exact labels', () => {
    render(<AIPanel selectedText="" onAction={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rephrase' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summarise' })).toBeInTheDocument();
  });

  it('renders the fallback context message when selectedText is empty', () => {
    render(<AIPanel selectedText="" onAction={vi.fn()} />);

    const region = screen.getByRole('region', { name: 'Selection context' });
    expect(region).toHaveTextContent('Highlight text in the editor to use it as context.');
  });

  it('renders the selected text inside the context region when non-empty', () => {
    render(<AIPanel selectedText="The dragon roared." onAction={vi.fn()} />);

    const region = screen.getByRole('region', { name: 'Selection context' });
    expect(region).toHaveTextContent('The dragon roared.');
  });

  it('fires onAction("rephrase") when Rephrase is clicked with non-empty selectedText', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<AIPanel selectedText="some selected text" onAction={onAction} />);

    await user.click(screen.getByRole('button', { name: 'Rephrase' }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('rephrase');
  });

  it('disables Rephrase/Expand/Summarise but not Continue when selectedText is empty', () => {
    render(<AIPanel selectedText="" onAction={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rephrase' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Summarise' })).toBeDisabled();
  });

  it('disables all four action buttons and Run when pending is true', () => {
    render(<AIPanel selectedText="hello" onAction={vi.fn()} pending />);

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rephrase' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Summarise' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('enables Run when freeform textarea has content and fires onAction with trimmed text', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<AIPanel selectedText="" onAction={onAction} />);

    const textarea = screen.getByLabelText('Freeform instruction');
    const runButton = screen.getByRole('button', { name: 'Run' });

    expect(runButton).toBeDisabled();

    await user.type(textarea, '  make it spooky  ');
    expect(runButton).toBeEnabled();

    await user.click(runButton);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('freeform', 'make it spooky');
  });

  it('keeps Run disabled when textarea has only whitespace', async () => {
    const user = userEvent.setup();
    render(<AIPanel selectedText="" onAction={vi.fn()} />);

    const textarea = screen.getByLabelText('Freeform instruction');
    const runButton = screen.getByRole('button', { name: 'Run' });

    await user.type(textarea, '   ');
    expect(runButton).toBeDisabled();
  });
});
