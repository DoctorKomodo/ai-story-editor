import type { JSX } from 'react';
import { RecoveryCodeCard } from './RecoveryCodeCard';

export interface RecoveryCodeHandoffProps {
  recoveryCode: string;
  username: string;
  onContinue: () => void;
  /**
   * Test seam: see `RecoveryCodeCard` for rationale.
   */
  onDownload?: (filename: string, content: string) => void;
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

          <RecoveryCodeCard
            recoveryCode={recoveryCode}
            username={username}
            primaryLabel="Continue to Inkwell"
            onConfirm={onContinue}
            onDownload={onDownload}
          />
        </div>
      </div>
    </main>
  );
}
