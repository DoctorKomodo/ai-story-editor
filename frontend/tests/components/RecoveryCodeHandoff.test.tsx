import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryCodeHandoff } from '@/components/RecoveryCodeHandoff';

describe('<RecoveryCodeHandoff>', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderHandoff(
    overrides: Partial<React.ComponentProps<typeof RecoveryCodeHandoff>> = {},
  ): { onContinue: ReturnType<typeof vi.fn> } {
    const onContinue = vi.fn();
    render(
      <RecoveryCodeHandoff
        recoveryCode="horse-battery-staple-correct-glow-mint-velvet-pearl-orbit-quiet-amber-crisp"
        username="alice"
        onContinue={onContinue}
        {...overrides}
      />,
    );
    return { onContinue };
  }

  it('renders the recovery code, the warning, and the brand', () => {
    renderHandoff();
    expect(screen.getByRole('heading', { name: /save your recovery code/i })).toBeInTheDocument();
    expect(screen.getByText(/show once/i)).toBeInTheDocument();
    expect(screen.getByText(/horse-battery-staple/)).toBeInTheDocument();
  });

  it('continue button is disabled until the confirmation checkbox is ticked', async () => {
    const user = userEvent.setup();
    const { onContinue } = renderHandoff();

    const continueBtn = screen.getByRole('button', { name: /continue to inkwell/i });
    expect(continueBtn).toBeDisabled();

    await user.click(continueBtn);
    expect(onContinue).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: /i have stored/i }));
    expect(continueBtn).not.toBeDisabled();

    await user.click(continueBtn);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('copy button writes the recovery code to the clipboard and flashes "Copied"', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderHandoff();

    const copyBtn = screen.getByRole('button', { name: /^copy$/i });
    // fireEvent / .click() avoids userEvent's async pipeline, which fights
    // fake timers (see AIStream.test.tsx for the same pattern).
    await act(async () => {
      copyBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(
      'horse-battery-staple-correct-glow-mint-velvet-pearl-orbit-quiet-amber-crisp',
    );
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();

    // Label reverts after the flash window.
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument();
  });

  it('download button calls the injected download function with a sensible filename and body', async () => {
    const onDownload = vi.fn();
    const user = userEvent.setup();
    renderHandoff({ onDownload });

    await user.click(screen.getByRole('button', { name: /download as \.txt/i }));

    expect(onDownload).toHaveBeenCalledTimes(1);
    const [filename, content] = onDownload.mock.calls[0] as [string, string];
    expect(filename).toBe('inkwell-recovery-code-alice.txt');
    expect(content).toContain('horse-battery-staple');
    expect(content).toContain('Username: alice');
    expect(content).toMatch(/without it and your password/i);
  });

  it('does not respond to Escape (cannot dismiss)', async () => {
    const user = userEvent.setup();
    const { onContinue } = renderHandoff();
    await user.keyboard('{Escape}');
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('shows a fallback note when navigator.clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    renderHandoff();

    const copyBtn = screen.getByRole('button', { name: /^copy$/i });
    await act(async () => {
      copyBtn.click();
      await Promise.resolve();
    });

    expect(screen.getByText(/copy isn.t available in this browser/i)).toBeInTheDocument();
    // Continue gate is still reachable — failure does not break the flow.
    expect(screen.getByRole('button', { name: /continue to inkwell/i })).toBeInTheDocument();
  });

  it('shows a fallback note when navigator.clipboard.writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderHandoff();

    const copyBtn = screen.getByRole('button', { name: /^copy$/i });
    await act(async () => {
      copyBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/copy isn.t available in this browser/i)).toBeInTheDocument();
  });
});
