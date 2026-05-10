/**
 * CopyAction wired with useCopyToClipboard — integration test.
 *
 * Asserts the wiring contract: clicking the copy button drives the hook,
 * which calls the Clipboard API (or the execCommand fallback), and the
 * resulting status reaches the visible "Copied" label inside CopyAction.
 *
 * ChatTab and SceneTab use the identical wiring pattern; one tiny harness
 * covers both — no need to mount the full chat-history tree.
 *
 * Note: tests use `act` + `element.click()` rather than userEvent because
 * userEvent's async pipeline fights vi.useFakeTimers (see RecoveryCodeCard.test.tsx
 * for the same pattern).
 */
import { act, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyAction } from '@/components/messageRow/primitives';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

function CopyHarness({ text }: { text: string }): JSX.Element {
  const { copy, status } = useCopyToClipboard({ resetMs: 1000 });
  return <CopyAction onClick={() => void copy(text)} status={status} />;
}

describe('CopyAction wired with useCopyToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const originalIsSecureContext = window.isSecureContext;

  function setSecureContext(value: boolean): void {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    setSecureContext(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    setSecureContext(originalIsSecureContext);
  });

  it('clicking the icon writes via Clipboard API and shows "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<CopyHarness text="ASSISTANT_REPLY" />);
    const btn = screen.getByRole('button', { name: 'Copy' });

    await act(async () => {
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('ASSISTANT_REPLY');
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('Clipboard API undefined → falls back to execCommand and still shows "Copied"', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec as unknown as typeof document.execCommand;

    render(<CopyHarness text="LAN_REPLY" />);
    const btn = screen.getByRole('button', { name: 'Copy' });

    await act(async () => {
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(exec).toHaveBeenCalledWith('copy');
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });
});
