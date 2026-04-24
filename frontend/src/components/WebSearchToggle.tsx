/**
 * [F14] Web-search toggle for the AI panel.
 *
 * Renders a labelled checkbox that exposes Venice's `enableWebSearch` flag to
 * the user. Only visible when the currently selected model advertises
 * `supportsWebSearch: true` — capability data flows from the backend via
 * `ModelInfo` → `useModelsQuery` → `<ModelSelector />`'s sibling slot.
 *
 * Follow-ups:
 * - [F15] reads the `webSearch` state on `EditorPage` when calling
 *   `/api/ai/complete`; this component is pure UI.
 * - [F50] mirrors this pattern inside the chat panel and adds citation
 *   rendering for assistant messages that opted in.
 */
import type { Model } from '@/hooks/useModels';

export interface WebSearchToggleProps {
  model: Model | null;
  checked: boolean;
  onChange: (next: boolean) => void;
}

const HINT_ID = 'ai-web-search-hint';

export function WebSearchToggle({ model, checked, onChange }: WebSearchToggleProps): JSX.Element | null {
  if (model == null || model.supportsWebSearch === false) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="ai-web-search" className="flex items-center gap-2 text-sm text-neutral-700">
        <input
          id="ai-web-search"
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            onChange(e.target.checked);
          }}
          aria-describedby={HINT_ID}
          className="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-400"
        />
        <span>Web search</span>
      </label>
      <p id={HINT_ID} className="text-xs text-neutral-500">
        May increase response time and cost.
      </p>
    </div>
  );
}
