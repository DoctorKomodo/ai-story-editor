import type { JSX } from 'react';
import { useState } from 'react';
import { downloadTxt } from '@/lib/downloadTxt';

export interface RecoveryCodeHandoffProps {
  recoveryCode: string;
  username: string;
  onContinue: () => void;
  /**
   * Test seam: lets the page-level test verify download contents without
   * mocking Blob / URL.createObjectURL / anchor.click. Defaults to the
   * existing downloadTxt utility used elsewhere in the app.
   */
  onDownload?: (filename: string, content: string) => void;
}

const COPIED_FLASH_MS = 2000;

function buildDownloadBody(username: string, recoveryCode: string): string {
  return [
    'Inkwell recovery code',
    `Username: ${username}`,
    `Recovery code: ${recoveryCode}`,
    '',
    'Keep this somewhere safe. Without it AND your password, your encrypted',
    'stories cannot be recovered.',
    '',
  ].join('\n');
}

function FeatherIcon(): JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
      <line x1="16" y1="8" x2="2" y2="22" />
      <line x1="17.5" y1="15" x2="9" y2="15" />
    </svg>
  );
}

export function RecoveryCodeHandoff({
  recoveryCode,
  username,
  onContinue,
  onDownload,
}: RecoveryCodeHandoffProps): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async (): Promise<void> => {
    // navigator.clipboard is undefined in non-secure contexts (HTTP self-host
    // without TLS). Guard before calling so we surface the same fallback
    // path as a runtime rejection.
    if (!navigator.clipboard?.writeText) {
      setCopyFailed(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => {
        setCopied(false);
      }, COPIED_FLASH_MS);
    } catch {
      // Permissions denied, etc. Surface a small note pointing the user at
      // Download (which always works) and the manual select-all on the box
      // (the box has `user-select: all`). Never throw — the gating button
      // must remain reachable.
      setCopyFailed(true);
    }
  };

  const download = (): void => {
    const filename = `inkwell-recovery-code-${username}.txt`;
    const body = buildDownloadBody(username, recoveryCode);
    if (onDownload) {
      onDownload(filename, body);
    } else {
      downloadTxt(filename, body);
    }
  };

  return (
    <main className="auth-screen">
      <aside className="auth-hero hidden md:flex flex-col justify-between p-9 md:p-11 bg-[var(--bg-sunken)] border-r border-[var(--line)]">
        <div className="flex items-center gap-2.5 font-serif italic text-[22px] text-[var(--ink)]">
          <FeatherIcon />
          <span>Inkwell</span>
        </div>
        <blockquote className="font-serif italic text-[22px] leading-[1.5] text-[var(--ink-2)] max-w-[440px] m-0">
          “Keep this code somewhere only you can reach. It is the second of two locks on your
          stories — your password is the first.”
          <cite className="block mt-3.5 font-sans not-italic text-[12px] text-[var(--ink-4)] tracking-[0.04em] uppercase">
            — inkwell handbook
          </cite>
        </blockquote>
        <div className="flex gap-2 font-mono text-[11px] text-[var(--ink-4)]">
          <span>Self-hosted · v0.4.2</span>
          <span>·</span>
          <span>inkwell-01</span>
        </div>
      </aside>

      <div className="grid place-items-center p-9">
        <div className="recovery-code-card">
          <h1 className="font-serif text-[28px] font-medium leading-tight tracking-[-0.01em] text-[var(--ink)] m-0">
            Save your recovery code
          </h1>
          <p className="text-[13px] text-[var(--ink-3)] leading-relaxed m-0">
            This is the only thing that can unlock your stories if you forget your password. We will
            not show it again.
          </p>

          <div className="recovery-code-warning" role="note">
            <strong>Show once.</strong> Inkwell does not store this anywhere it can read. Lose your
            password and this code, and your stories are gone for good.
          </div>

          <div className="recovery-code-box" data-testid="recovery-code-box">
            <code>{recoveryCode}</code>
          </div>

          <div className="recovery-code-actions">
            <button
              type="button"
              onClick={() => {
                void copy();
              }}
              aria-live="polite"
              className="inline-flex items-center justify-center px-3 py-2 text-[12.5px] font-medium font-sans bg-[var(--bg-elevated)] text-[var(--ink)] border border-[var(--line-2)] rounded-[var(--radius)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={download}
              className="inline-flex items-center justify-center px-3 py-2 text-[12.5px] font-medium font-sans bg-[var(--bg-elevated)] text-[var(--ink)] border border-[var(--line-2)] rounded-[var(--radius)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              Download as .txt
            </button>
          </div>

          {copyFailed ? (
            <p role="status" className="text-[12px] text-[var(--ink-3)] m-0">
              Copy isn’t available in this browser. Use Download, or select the code above and copy
              it manually.
            </p>
          ) : null}

          <label className="recovery-code-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
              }}
            />
            <span>I have stored my recovery code somewhere safe.</span>
          </label>

          <button
            type="button"
            disabled={!confirmed}
            onClick={onContinue}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 mt-1 text-[13px] font-medium font-sans bg-[var(--ink)] text-[var(--bg)] rounded-[var(--radius)] hover:bg-[var(--ink-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Continue to Inkwell
          </button>
        </div>
      </div>
    </main>
  );
}
