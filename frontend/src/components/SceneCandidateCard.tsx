import type { JSX } from 'react';
import { ThinkingDots } from '@/design/ThinkingDots';

/**
 * [SC11] Scene candidate card — renders a single AI-generated prose candidate
 * within the Scene tab's chat-like flow.
 *
 * Shows the user direction in a right-aligned bubble, then the generated
 * candidate text in an article card. The footer row adapts to the card's
 * state:
 *  - `streaming`: progress label, no action buttons.
 *  - `done` + `isLatest`: Insert at end, Retry, Copy buttons + model label.
 *  - `done` + `!isLatest`: Insert at end, Copy buttons + model label + "superseded" marker.
 *  - `error`: no action buttons (error display is handled by the parent).
 */

export interface SceneCandidateCardProps {
  /** The user-entered scene direction. */
  direction: string;
  /** The AI-generated prose candidate. */
  candidate: string;
  /** Current generation state. */
  state: 'streaming' | 'done' | 'error';
  /** Whether this is the most-recent candidate for this direction. */
  isLatest: boolean;
  /** Display name of the model that generated this candidate. */
  model?: string;
  /** Insert the candidate text at the end of the current chapter. */
  onInsert: () => void;
  /** Re-run generation with the same direction and model. */
  onRetry: () => void;
  /** Copy the candidate text to the clipboard. */
  onCopy: () => void;
}

function RetryIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15A9 9 0 1 1 5.64 5.64L23 10" />
    </svg>
  );
}

export function SceneCandidateCard({
  direction,
  candidate,
  state,
  isLatest,
  model,
  onInsert,
  onRetry,
  onCopy,
}: SceneCandidateCardProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2" data-testid="scene-candidate">
      {/* Direction bubble — right-aligned, matches user messages in ChatMessages */}
      <div className="self-end max-w-[85%] bg-[var(--accent-soft)] rounded-[var(--radius-lg)] px-3 py-2 text-[13px] text-ink leading-snug">
        {direction}
      </div>

      {/* Candidate card */}
      <article className="rounded-[var(--radius)] border border-line bg-bg px-3.5 py-3">
        {/* Prose body — left-border accent matches assistant bubbles in ChatMessages.
            When streaming with no content yet, show the thinking dots in the prose
            area (same pattern as ChatMessages DraftPair). */}
        {state === 'streaming' && candidate.length === 0 ? (
          <div
            className="pl-3 border-l-2 border-[var(--ai)] py-1"
            data-testid="scene-candidate-text"
          >
            <ThinkingDots label="Generating scene…" />
          </div>
        ) : (
          <div
            className="pl-3 border-l-2 border-[var(--ai)] font-serif text-[14.5px] text-ink leading-[1.55] whitespace-pre-wrap"
            data-testid="scene-candidate-text"
          >
            {candidate}
          </div>
        )}

        {/* Streaming state footer */}
        {state === 'streaming' && (
          <div className="mt-3 text-[11px] font-mono text-ink-4">
            streaming via {model ?? 'model'}…
          </div>
        )}

        {/* Done state */}
        {state === 'done' && (
          <div className="flex flex-col gap-1.5 mt-3">
            {/* Action buttons */}
            <div className="flex items-center gap-1 text-[12px]">
              <button
                type="button"
                onClick={onInsert}
                className="px-2 py-1 rounded-[var(--radius)] text-[var(--ai)] border border-[var(--ai)] hover:bg-[var(--ai-soft)] transition-colors"
              >
                Insert at end
              </button>
              {isLatest && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="px-2 py-1 rounded-[var(--radius)] text-ink-2 hover:bg-surface-hover inline-flex items-center gap-1 transition-colors"
                  title="Generate another candidate with the current model"
                >
                  <RetryIcon />
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={onCopy}
                className="px-2 py-1 rounded-[var(--radius)] text-ink-2 hover:bg-surface-hover transition-colors"
              >
                Copy
              </button>
            </div>

            {/* Metadata row */}
            <div className="flex items-center gap-2 text-[10px] font-mono text-ink-4">
              {model !== undefined && model.length > 0 && <span>{model}</span>}
              {!isLatest && <span>· superseded</span>}
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
