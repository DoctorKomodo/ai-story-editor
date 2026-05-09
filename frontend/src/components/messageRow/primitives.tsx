import type { JSX, ReactNode } from 'react';
import { MessageCitations } from '@/components/MessageCitations';
import { ThinkingDots } from '@/design/ThinkingDots';
import { useModelsQuery } from '@/hooks/useModels';
import type { Citation } from '@/lib/citations';

/* ---------------- AssistantBubble ---------------- */

export interface AssistantBubbleProps {
  children: ReactNode;
}

export function AssistantBubble({ children }: AssistantBubbleProps): JSX.Element {
  return (
    <div className="pl-3 border-l-2 border-[var(--ai)] font-serif text-[13.5px] leading-[1.55] text-ink whitespace-pre-wrap max-w-full">
      {children}
    </div>
  );
}

/* ---------------- ThinkingBubble ---------------- */

export interface ThinkingBubbleProps {
  label?: string;
}

export function ThinkingBubble({ label }: ThinkingBubbleProps): JSX.Element {
  return (
    <div className="pl-3 border-l-2 border-[var(--ai)] py-1">
      <ThinkingDots {...(label !== undefined ? { label } : {})} />
    </div>
  );
}

/* ---------------- MessageMeta ---------------- */

export interface MessageMetaProps {
  model: string | null;
  tokens: number | null;
  latencyMs: number | null;
}

/**
 * Renders the meta row under an assistant message: model name (resolved
 * from id via useModelsQuery), tokens count, latency. Hidden parts skip
 * cleanly so the row only shows what's available.
 */
export function MessageMeta({ model, tokens, latencyMs }: MessageMetaProps): JSX.Element | null {
  const { data: models } = useModelsQuery();
  const displayName =
    model !== null && models ? (models.find((m) => m.id === model)?.name ?? model) : null;
  const showStats = tokens !== null && latencyMs !== null;
  if (!displayName && !showStats) return null;
  return (
    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-ink-4 font-mono">
      {displayName !== null && <span>{displayName}</span>}
      {showStats ? (
        <span>{`${String(tokens ?? 0)} tok · ${((latencyMs ?? 0) / 1000).toFixed(1)}s`}</span>
      ) : null}
    </div>
  );
}

/* ---------------- MessageActions ---------------- */

export interface MessageActionsProps {
  children: ReactNode;
}

export function MessageActions({ children }: MessageActionsProps): JSX.Element {
  return <div className="flex items-center gap-1 mt-1.5 text-[12px]">{children}</div>;
}

/* ---------------- CopyAction ---------------- */

export interface CopyActionProps {
  onClick: () => void;
  disabled?: boolean;
}

function CopyIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CopyAction({ onClick, disabled }: CopyActionProps): JSX.Element {
  return (
    <button
      type="button"
      className="px-2 py-1 rounded-[var(--radius)] text-ink-2 hover:bg-surface-hover inline-flex items-center gap-1 transition-colors disabled:opacity-60"
      aria-label="Copy"
      title="Copy"
      onClick={onClick}
      disabled={disabled}
    >
      <CopyIcon />
    </button>
  );
}

/* ---------------- RegenerateAction ---------------- */

export interface RegenerateActionProps {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}

function RegenerateIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function RegenerateAction({
  onClick,
  disabled,
  label = 'Regenerate',
}: RegenerateActionProps): JSX.Element {
  return (
    <button
      type="button"
      className="px-2 py-1 rounded-[var(--radius)] text-ink-2 hover:bg-surface-hover inline-flex items-center gap-1 transition-colors disabled:opacity-60"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <RegenerateIcon />
    </button>
  );
}

/* ---------------- InsertAtEndAction ---------------- */

export interface InsertAtEndActionProps {
  onClick: () => void;
  disabled?: boolean;
}

export function InsertAtEndAction({ onClick, disabled }: InsertAtEndActionProps): JSX.Element {
  return (
    <button
      type="button"
      className="px-2 py-1 rounded-[var(--radius)] text-[var(--ai)] border border-[var(--ai)] hover:bg-[var(--ai-soft)] transition-colors disabled:opacity-60"
      onClick={onClick}
      disabled={disabled}
    >
      Insert at end
    </button>
  );
}

/* ---------------- CitationsSlot ---------------- */

export interface CitationsSlotProps {
  citations: Citation[] | null;
  messageId: string;
}

/**
 * Wraps MessageCitations in a stable mount-point slot (per F50 contract:
 * the slot exists for every assistant bubble; MessageCitations returns
 * null when there are no citations).
 */
export function CitationsSlot({ citations, messageId }: CitationsSlotProps): JSX.Element {
  return (
    <div data-citations-slot data-message-id={messageId}>
      <MessageCitations citations={citations} />
    </div>
  );
}
