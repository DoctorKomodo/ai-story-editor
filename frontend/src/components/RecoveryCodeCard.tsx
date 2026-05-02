import type { JSX } from 'react';
import { useState } from 'react';
import { downloadTxt } from '@/lib/downloadTxt';

export interface RecoveryCodeCardProps {
  recoveryCode: string;
  username: string;
  primaryLabel: string;
  onConfirm: () => void;
  /**
   * Test seam: bypass real Blob / URL.createObjectURL plumbing in unit tests.
   * Defaults to the existing downloadTxt utility used elsewhere in the app.
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

export function RecoveryCodeCard({
  recoveryCode,
  username,
  primaryLabel,
  onConfirm,
  onDownload,
}: RecoveryCodeCardProps): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async (): Promise<void> => {
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
    <>
      <div className="recovery-code-box" data-testid="recovery-code-box">
        <code>{recoveryCode}</code>
      </div>

      <div className="recovery-code-actions">
        <button
          type="button"
          onClick={() => {
            void copy();
          }}
          className="inline-flex items-center justify-center px-3 py-2 text-[12.5px] font-medium font-sans bg-[var(--bg-elevated)] text-[var(--ink)] border border-[var(--line-2)] rounded-[var(--radius)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <span aria-live="polite" aria-atomic="true">
            {copied ? 'Copied' : 'Copy'}
          </span>
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
          Copy isn’t available in this browser. Use Download, or select the code above and copy it
          manually.
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
        onClick={onConfirm}
        className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 mt-1 text-[13px] font-medium font-sans bg-[var(--ink)] text-[var(--bg)] rounded-[var(--radius)] hover:bg-[var(--ink-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {primaryLabel}
      </button>
    </>
  );
}
