/**
 * [F13] Venice model dropdown.
 *
 * Native `<select>` with two `<optgroup>` sections — "Reasoning" for
 * models whose `supportsReasoning` is true, "Standard" for the rest. Order
 * inside each group preserves the server's order.
 *
 * Each option label renders `"${name} · ${formatContextLength(contextLength)}"`,
 * e.g. `"Llama 3.3 70B · 125K"`. When `contextLength` is 0 (unknown) the
 * suffix is omitted.
 *
 * Auto-selects the first model once the list loads if `value` is null — the
 * parent (`EditorPage`) is responsible for persisting the chosen id via
 * `useSelectedModel`.
 *
 * Follow-ups:
 * - [F15] consumes the selected id when invoking `/api/ai/complete`.
 * - [F42] replaces this with the mockup-spec custom popover.
 */
import { useEffect } from 'react';
import { type Model, useModelsQuery } from '@/hooks/useModels';
import { ApiError } from '@/lib/api';

export interface ModelSelectorProps {
  value: string | null;
  onChange: (modelId: string) => void;
}

export function formatContextLength(n: number): string {
  if (n <= 0) return '';
  if (n >= 1024) {
    const k = Math.round(n / 1024);
    return `${String(k)}K`;
  }
  return String(n);
}

function optionLabel(model: Model): string {
  const suffix = formatContextLength(model.contextLength);
  return suffix.length > 0 ? `${model.name} · ${suffix}` : model.name;
}

export function ModelSelector({ value, onChange }: ModelSelectorProps): JSX.Element {
  const { data, isLoading, isError, error } = useModelsQuery();

  // Auto-select the first model once the list loads, if the parent hasn't
  // supplied a value yet. Runs only when data is present so we never pre-empt
  // an incoming stored id.
  useEffect(() => {
    if (value != null) return;
    const first = data?.[0];
    if (!first) return;
    onChange(first.id);
  }, [value, data, onChange]);

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="text-sm text-neutral-500">
        Loading models…
      </div>
    );
  }

  if (isError) {
    if (error instanceof ApiError && error.code === 'venice_key_required') {
      return (
        <p role="alert" className="text-sm text-red-600">
          Add a Venice API key in Settings to load models.
        </p>
      );
    }
    return (
      <p role="alert" className="text-sm text-red-600">
        Could not load models{error?.message ? `: ${error.message}` : ''}
      </p>
    );
  }

  const models = data ?? [];
  const reasoning = models.filter((m) => m.supportsReasoning);
  const standard = models.filter((m) => !m.supportsReasoning);

  return (
    <select
      aria-label="Model"
      value={value ?? ''}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
    >
      {reasoning.length > 0 && (
        <optgroup label="Reasoning">
          {reasoning.map((m) => (
            <option key={m.id} value={m.id}>
              {optionLabel(m)}
            </option>
          ))}
        </optgroup>
      )}
      {standard.length > 0 && (
        <optgroup label="Standard">
          {standard.map((m) => (
            <option key={m.id} value={m.id}>
              {optionLabel(m)}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
