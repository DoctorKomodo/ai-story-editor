// frontend/src/components/SettingsPromptsTab.tsx
//
// [X29] Settings → Prompts tab. Six rows (system + 5 action templates),
// each displaying its built-in default read-only by default. Ticking
// "Override default" enables an editable field seeded with the current
// default text and PATCHes settings.prompts.{key}. Unticking PATCHes
// null and reverts to the read-only default.

import type { ChangeEvent, JSX } from 'react';
import { useId, useState } from 'react';
import { type DefaultPrompts, useDefaultPromptsQuery } from '@/hooks/useDefaultPrompts';
import { useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';

type PromptKey = keyof DefaultPrompts;

interface RowMeta {
  key: PromptKey;
  label: string;
  hint: string;
  multiline: boolean;
}

const ROWS: ReadonlyArray<RowMeta> = [
  {
    key: 'system',
    label: 'System prompt',
    hint: 'Replaces the default system message sent on every AI call.',
    multiline: true,
  },
  {
    key: 'continue',
    label: 'Continue',
    hint: 'Used when continuing the story (⌥+Enter, AI panel).',
    multiline: false,
  },
  {
    key: 'rewrite',
    label: 'Rewrite / Rephrase',
    hint: 'Used by both the selection bubble and the AI panel.',
    multiline: false,
  },
  { key: 'expand', label: 'Expand', hint: 'Used when expanding a selection.', multiline: false },
  {
    key: 'summarise',
    label: 'Summarise',
    hint: 'Used when summarising a selection.',
    multiline: false,
  },
  {
    key: 'describe',
    label: 'Describe',
    hint: 'Used when describing the subject of a selection.',
    multiline: false,
  },
];

export function SettingsPromptsTab(): JSX.Element {
  const settings = useUserSettings();
  const updateSetting = useUpdateUserSetting();
  const defaultsQuery = useDefaultPromptsQuery();
  const defaults = defaultsQuery.data;

  return (
    <div className="flex flex-col gap-6" data-testid="settings-prompts-tab">
      <header>
        <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Prompts</h3>
        <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
          Override the default system prompt and action templates. Unchecked rows use the built-in
          default shown.
        </p>
      </header>

      {!defaults ? (
        <div className="py-6 text-center font-mono text-[12px] text-ink-4">Loading prompts…</div>
      ) : (
        ROWS.map((row) => (
          <PromptRow
            key={row.key}
            meta={row}
            defaultText={defaults[row.key]}
            override={settings.prompts[row.key]}
            onPatch={(next) => {
              updateSetting.mutate({ prompts: { [row.key]: next } });
            }}
          />
        ))
      )}
    </div>
  );
}

interface PromptRowProps {
  meta: RowMeta;
  defaultText: string;
  override: string | null;
  onPatch: (next: string | null) => void;
}

function PromptRow({ meta, defaultText, override, onPatch }: PromptRowProps): JSX.Element {
  const fieldId = useId();
  const checked = override !== null;
  const [draft, setDraft] = useState<string>(override ?? defaultText);

  const handleToggle = (e: ChangeEvent<HTMLInputElement>): void => {
    if (e.target.checked) {
      const seed = override ?? defaultText;
      setDraft(seed);
      onPatch(seed);
    } else {
      setDraft(defaultText);
      onPatch(null);
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setDraft(e.target.value);
  };

  const handleBlur = (): void => {
    if (!checked) return;
    const trimmed = draft.trim();
    const next = trimmed.length === 0 ? null : draft;
    if (next === override) return;
    onPatch(next);
  };

  return (
    <section
      className="flex flex-col gap-2 border border-line rounded-[var(--radius)] p-3"
      data-testid={`prompts-row-${meta.key}`}
    >
      <header className="flex flex-col gap-[2px]">
        <span className="font-medium text-[12px] text-ink-2">{meta.label}</span>
        <span className="text-[12px] text-ink-4 font-sans">{meta.hint}</span>
      </header>

      {checked ? (
        meta.multiline ? (
          <textarea
            id={fieldId}
            data-testid={`prompts-editor-${meta.key}`}
            value={draft}
            onChange={handleChange}
            onBlur={handleBlur}
            spellCheck={false}
            className="font-serif w-full min-h-[120px] p-3 border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3"
          />
        ) : (
          <input
            id={fieldId}
            data-testid={`prompts-editor-${meta.key}`}
            type="text"
            value={draft}
            onChange={handleChange}
            onBlur={handleBlur}
            spellCheck={false}
            className="font-serif w-full p-2 border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3"
          />
        )
      ) : meta.multiline ? (
        <div
          data-testid={`prompts-default-${meta.key}`}
          className="font-serif w-full min-h-[120px] p-3 border border-line rounded-[var(--radius)] bg-bg-2 text-ink-4 whitespace-pre-wrap"
        >
          {defaultText}
        </div>
      ) : (
        <div
          data-testid={`prompts-default-${meta.key}`}
          className="font-serif w-full p-2 border border-line rounded-[var(--radius)] bg-bg-2 text-ink-4"
        >
          {defaultText}
        </div>
      )}

      <label className="flex items-center gap-2 text-[12px]">
        <input
          type="checkbox"
          data-testid={`prompts-toggle-${meta.key}`}
          checked={checked}
          onChange={handleToggle}
        />
        <span className="text-ink-2">Override default</span>
      </label>
    </section>
  );
}
