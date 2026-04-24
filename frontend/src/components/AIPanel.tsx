import { useState } from 'react';

/**
 * AI assistant panel (F12).
 *
 * Placeholder-scope: renders the selection-context block, four preset
 * actions (Continue / Rephrase / Expand / Summarise), and a freeform
 * instruction textarea + Run button. UI-only — the `onAction` callback
 * is what F15 will wire to `/api/ai/complete` streaming.
 *
 * Follow-ups:
 * - F13 adds the model selector above the actions.
 * - F14 adds the web-search toggle.
 * - F15 wires the streaming call and shows results inline.
 * - F38 redesigns the whole chat panel to the mockup spec.
 *
 * Continue is enabled even with no selection because V12/V14 treat it as
 * the cursor-context action (continues from where the cursor is); the
 * other three actions operate on a highlighted range and are disabled
 * until there's a selection.
 */
export type AIAction = 'continue' | 'rephrase' | 'expand' | 'summarise' | 'freeform';

export interface AIPanelProps {
  selectedText: string;
  onAction: (action: AIAction, freeformInstruction?: string) => void;
  pending?: boolean;
  /**
   * [F13] Optional model-picker slot rendered above the action buttons.
   * Kept as a `ReactNode` slot so the panel stays agnostic of TanStack Query
   * / localStorage concerns — the parent page owns wiring.
   */
  modelSelector?: React.ReactNode;
  /**
   * [F14] Optional web-search toggle slot rendered between the selection-context
   * block and the action buttons. Parent (`EditorPage`) owns the checked state
   * and the capability-gated render via `<WebSearchToggle />`.
   */
  webSearchToggle?: React.ReactNode;
  /**
   * [F15] Optional result slot rendered below the freeform section. Parent
   * passes an `<AIResult />` driven by `useAICompletion()`. The slot keeps
   * this panel agnostic of the streaming-hook wiring.
   */
  result?: React.ReactNode;
  /**
   * [F15] Optional friendly message surfaced under the action buttons when
   * the user clicks an action without a required prerequisite (e.g. no model
   * selected, no chapter selected). Rendered with `role="alert"`.
   */
  actionError?: string | null;
  /**
   * [F16] Optional usage indicator slot rendered beneath the result slot.
   * Persistent across requests — the parent drives render by passing a
   * `<UsageIndicator usage={completion.usage} />` that returns null when
   * no snapshot exists yet.
   */
  usage?: React.ReactNode;
}

const SELECTION_DISPLAY_MAX = 200;
const FREEFORM_MAX = 2000;

function displaySelection(text: string): string {
  if (text.length <= SELECTION_DISPLAY_MAX) return text;
  return `${text.slice(0, SELECTION_DISPLAY_MAX)}…`;
}

const actionButtonClass =
  'rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors disabled:opacity-50';

export function AIPanel({
  selectedText,
  onAction,
  pending = false,
  modelSelector,
  webSearchToggle,
  result,
  actionError,
  usage,
}: AIPanelProps): JSX.Element {
  const [freeform, setFreeform] = useState('');

  const hasSelection = selectedText.length > 0;
  const trimmedFreeform = freeform.trim();
  const freeformReady = trimmedFreeform.length > 0 && !pending;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">AI</h2>

      <section
        aria-label="Selection context"
        className="rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700"
      >
        {hasSelection ? (
          <p className="whitespace-pre-wrap break-words">{displaySelection(selectedText)}</p>
        ) : (
          <p className="text-neutral-500">Highlight text in the editor to use it as context.</p>
        )}
      </section>

      {modelSelector !== undefined && (
        <section aria-label="Model" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-neutral-700">Model</h3>
          {modelSelector}
        </section>
      )}

      {webSearchToggle !== undefined && webSearchToggle}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className={actionButtonClass}
          disabled={pending}
          onClick={() => {
            onAction('continue');
          }}
        >
          Continue
        </button>
        <button
          type="button"
          className={actionButtonClass}
          disabled={pending || !hasSelection}
          onClick={() => {
            onAction('rephrase');
          }}
        >
          Rephrase
        </button>
        <button
          type="button"
          className={actionButtonClass}
          disabled={pending || !hasSelection}
          onClick={() => {
            onAction('expand');
          }}
        >
          Expand
        </button>
        <button
          type="button"
          className={actionButtonClass}
          disabled={pending || !hasSelection}
          onClick={() => {
            onAction('summarise');
          }}
        >
          Summarise
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="ai-freeform" className="text-sm font-medium text-neutral-700">
          Freeform instruction
        </label>
        <textarea
          id="ai-freeform"
          value={freeform}
          onChange={(e) => {
            setFreeform(e.target.value);
          }}
          maxLength={FREEFORM_MAX}
          rows={3}
          className="w-full rounded border border-neutral-300 bg-white p-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          type="button"
          className={`${actionButtonClass} self-end`}
          disabled={!freeformReady}
          onClick={() => {
            onAction('freeform', trimmedFreeform);
          }}
        >
          Run
        </button>
      </div>

      {actionError !== undefined && actionError !== null && actionError.length > 0 && (
        <p role="alert" className="text-sm text-red-600">
          {actionError}
        </p>
      )}

      {result !== undefined && result !== null && result}

      {usage !== undefined && usage !== null && usage}
    </div>
  );
}
