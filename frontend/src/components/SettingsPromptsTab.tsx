// frontend/src/components/SettingsPromptsTab.tsx

import type { ChangeEvent, JSX } from 'react';
import { useId, useState } from 'react';
import { type DefaultPrompts, useDefaultPromptsQuery } from '@/hooks/useDefaultPrompts';
import { useUpdateUserSetting, useUserSettings } from '@/hooks/useUserSettings';

type PromptKey = keyof DefaultPrompts;

interface RowMeta {
  key: PromptKey;
  label: string;
  hint: string;
}

const ROWS: ReadonlyArray<RowMeta> = [
  {
    key: 'system',
    label: 'System prompt',
    hint: 'Replaces the default system message sent on every AI call.',
  },
  {
    key: 'continue',
    label: 'Continue',
    hint: 'Used when continuing the story (⌥+Enter, AI panel).',
  },
  {
    key: 'rewrite',
    label: 'Rewrite / Rephrase',
    hint: 'Used by both the selection bubble and the AI panel.',
  },
  { key: 'expand', label: 'Expand', hint: 'Used when expanding a selection.' },
  {
    key: 'summarise',
    label: 'Summarise',
    hint: 'Used when summarising a selection.',
  },
  {
    key: 'summariseChapter',
    label: 'Chapter summary (structured)',
    hint: 'Used to generate structured previous-chapter summaries (events, state, open threads).',
  },
  {
    key: 'describe',
    label: 'Describe',
    hint: 'Used when describing the subject of a selection.',
  },
  {
    key: 'scene',
    label: 'Scene',
    hint: 'Used by the Scene tab — turns a scene direction into a paragraph of prose.',
  },
  {
    key: 'ask',
    label: 'Ask',
    hint: 'Used by the Chat (Ask) tab when answering questions about the story.',
  },
];

export function SettingsPromptsTab(): JSX.Element {
  const settings = useUserSettings();
  const updateSetting = useUpdateUserSetting();
  const defaultsQuery = useDefaultPromptsQuery();
  const defaults = defaultsQuery.data;

  return (
    <div className="flex flex-col gap-6" data-testid="settings-prompts-tab">
      <p className="text-[12px] text-ink-4 font-sans">
        Override the default system prompt and action templates. Unchecked rows use the built-in
        default shown.
      </p>

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

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
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
        <div
          data-testid={`prompts-default-${meta.key}`}
          className="font-serif w-full min-h-[120px] p-3 border border-line rounded-[var(--radius)] bg-bg-2 text-ink-4 whitespace-pre-wrap"
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
