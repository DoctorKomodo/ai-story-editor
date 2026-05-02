import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryCodeCard } from '@/components/RecoveryCodeCard';

const RECOVERY = 'XASBJ33Q-1HDKBA9X-DGRDS33D-0SNW7EXZ';
const USERNAME = 'alice';

describe('<RecoveryCodeCard>', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the supplied recovery code in the code box', () => {
    render(
      <RecoveryCodeCard
        recoveryCode={RECOVERY}
        username={USERNAME}
        primaryLabel="Done"
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByTestId('recovery-code-box')).toHaveTextContent(RECOVERY);
  });

  it('renders the supplied primary label', () => {
    render(
      <RecoveryCodeCard
        recoveryCode={RECOVERY}
        username={USERNAME}
        primaryLabel="Continue to Inkwell"
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Continue to Inkwell' })).toBeInTheDocument();
  });

  it('disables the primary button until the confirm checkbox is checked, then calls onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RecoveryCodeCard
        recoveryCode={RECOVERY}
        username={USERNAME}
        primaryLabel="Done"
        onConfirm={onConfirm}
      />,
    );
    const primary = screen.getByRole('button', { name: 'Done' });
    expect(primary).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /stored my recovery code/i }));
    expect(primary).toBeEnabled();
    await user.click(primary);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Copy button: success path flips label to Copied and back after the flash window', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <RecoveryCodeCard
        recoveryCode={RECOVERY}
        username={USERNAME}
        primaryLabel="Done"
        onConfirm={() => undefined}
      />,
    );
    const copy = screen.getByRole('button', { name: /^copy$/i });
    // fireEvent / .click() avoids userEvent's async pipeline, which fights
    // fake timers (matches the pattern in RecoveryCodeHandoff.test.tsx).
    await act(async () => {
      copy.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(RECOVERY);
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument();
  });

  it('Copy button: surfaces fallback note when navigator.clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    render(
      <RecoveryCodeCard
        recoveryCode={RECOVERY}
        username={USERNAME}
        primaryLabel="Done"
        onConfirm={() => undefined}
      />,
    );
    const copy = screen.getByRole('button', { name: /^copy$/i });
    await act(async () => {
      copy.click();
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Copy isn.t available/i);
  });

  it('Copy button: surfaces fallback note when clipboard.writeText rejects', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <RecoveryCodeCard
        recoveryCode={RECOVERY}
        username={USERNAME}
        primaryLabel="Done"
        onConfirm={() => undefined}
      />,
    );
    const copy = screen.getByRole('button', { name: /^copy$/i });
    await act(async () => {
      copy.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Copy isn.t available/i);
  });

  it('Download button: invokes onDownload with the documented filename and body', () => {
    const onDownload = vi.fn();
    render(
      <RecoveryCodeCard
        recoveryCode={RECOVERY}
        username={USERNAME}
        primaryLabel="Done"
        onConfirm={() => undefined}
        onDownload={onDownload}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download as .txt' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    const [filename, body] = onDownload.mock.calls[0];
    expect(filename).toBe(`inkwell-recovery-code-${USERNAME}.txt`);
    expect(body).toContain('Inkwell recovery code');
    expect(body).toContain(`Username: ${USERNAME}`);
    expect(body).toContain(`Recovery code: ${RECOVERY}`);
  });
});
