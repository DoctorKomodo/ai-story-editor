// [F45] Settings → Writing tab.
//
// Splits the writing toggles into two persistence buckets:
//
//   1. Backend-bound (PATCH /api/users/me/settings via [B11]):
//        - Typewriter mode  → `writing.typewriterMode`
//        - Focus paragraph  → `writing.focusMode`
//        - Daily goal       → `writing.dailyWordGoal`
//
//   2. localStorage-only (the backend `writing` shape doesn't carry these
//      fields today, and they're pure-frontend behaviours — auto-save is the
//      editor's responsibility, smart-quotes / em-dash are TipTap input
//      rules — so they don't strictly need server storage):
//        - Auto-save           → `inkwell.writing.autoSave` (default true)
//        - Smart quotes        → `inkwell.writing.smartQuotes` (default false)
//        - Em-dash expansion   → `inkwell.writing.emDashExpansion` (default false)
//
// Daily goal PATCHes are debounced (~400ms) so a quick typed change doesn't
// fire a request per keystroke. Toggle PATCHes are immediate — they're
// single-event changes.
import type { ChangeEvent, JSX, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { useUpdateUserSettingsMutation, useUserSettingsQuery } from '@/hooks/useUserSettings';

// --- localStorage helpers ----------------------------------------------------

const LS_KEYS = {
  autoSave: 'inkwell.writing.autoSave',
} as const;

function readBoolFromStorage(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function writeBoolToStorage(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Storage may be unavailable (private mode, quota); the toggle still
    // works in-memory for the session.
  }
}

/** Read + write a boolean flag persisted to localStorage. Initial value is
 * read once on mount; subsequent updates write through synchronously. */
function useLocalBool(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => readBoolFromStorage(key, fallback));
  const set = (next: boolean): void => {
    setValue(next);
    writeBoolToStorage(key, next);
  };
  return [value, set];
}

// --- Debounce hook ----------------------------------------------------------

function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    };
  }, []);

  return (...args: A): void => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fnRef.current(...args);
    }, delayMs);
  };
}

// --- ToggleRow ---------------------------------------------------------------

interface ToggleRowProps {
  id: string;
  label: string;
  hint?: ReactNode;
  testId: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({
  id,
  label,
  hint,
  testId,
  checked,
  disabled,
  onChange,
}: ToggleRowProps): JSX.Element {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-[12px] py-1">
      <input
        id={id}
        data-testid={testId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onChange(e.target.checked);
        }}
        className="mt-1"
      />
      <span className="flex flex-col gap-[2px]">
        <span className="font-medium text-ink-2">{label}</span>
        {hint != null ? <span className="text-ink-4 font-sans">{hint}</span> : null}
      </span>
    </label>
  );
}

// --- Main tab ---------------------------------------------------------------

export function SettingsWritingTab(): JSX.Element {
  const typewriterId = useId();
  const focusId = useId();
  const autoSaveId = useId();
  const smartQuotesId = useId();
  const emDashId = useId();
  const dailyGoalId = useId();

  const settingsQuery = useUserSettingsQuery();
  const updateSettings = useUpdateUserSettingsMutation();

  // localStorage-backed flag (auto-save is purely a frontend behaviour and
  // doesn't need server storage).
  const [autoSave, setAutoSave] = useLocalBool(LS_KEYS.autoSave, true);

  // Backend-bound toggles read directly from the query — single source of
  // truth, no local mirror. The PATCH mutation's onSuccess updates the cache
  // so the toggle flips as soon as the server confirms.
  const writing = settingsQuery.data?.writing;
  const typewriter = writing?.typewriterMode ?? false;
  const focusMode = writing?.focusMode ?? false;
  // [F66] Smart quotes + em-dash expansion are now persisted via B11.
  const smartQuotes = writing?.smartQuotes ?? false;
  const emDashExpansion = writing?.emDashExpansion ?? false;

  const handleTypewriter = (next: boolean): void => {
    if (writing == null) return;
    updateSettings.mutate({ writing: { typewriterMode: next } });
  };

  const handleFocusMode = (next: boolean): void => {
    if (writing == null) return;
    updateSettings.mutate({ writing: { focusMode: next } });
  };

  const handleSmartQuotes = (next: boolean): void => {
    if (writing == null) return;
    updateSettings.mutate({ writing: { smartQuotes: next } });
  };

  const handleEmDashExpansion = (next: boolean): void => {
    if (writing == null) return;
    updateSettings.mutate({ writing: { emDashExpansion: next } });
  };

  // --- Daily goal -----------------------------------------------------------

  // Local draft so typing feels responsive; PATCH is debounced. Re-seed
  // whenever the server-side value changes (e.g. settings refetch).
  const serverGoal = writing?.dailyWordGoal ?? 0;
  const [goalDraft, setGoalDraft] = useState<string>(String(serverGoal));
  const lastSeededGoalRef = useRef<number | null>(null);
  useEffect(() => {
    if (writing == null) return;
    if (lastSeededGoalRef.current === writing.dailyWordGoal) return;
    lastSeededGoalRef.current = writing.dailyWordGoal;
    setGoalDraft(String(writing.dailyWordGoal));
  }, [writing]);

  const flushGoal = useDebouncedCallback((value: number): void => {
    updateSettings.mutate({ writing: { dailyWordGoal: value } });
  }, 400);

  const handleGoalChange = (raw: string): void => {
    setGoalDraft(raw);
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 0) return;
    if (parsed > 100_000) return;
    flushGoal(parsed);
  };

  // --- Render ---------------------------------------------------------------

  const settingsLoading = !settingsQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <ToggleRow
        id={typewriterId}
        label="Typewriter mode"
        hint="Keep the active line vertically centered while writing"
        testId="writing-typewriter-toggle"
        checked={typewriter}
        disabled={settingsLoading || updateSettings.isPending}
        onChange={handleTypewriter}
      />
      <ToggleRow
        id={focusId}
        label="Focus paragraph"
        hint="Dim everything except the paragraph you're editing"
        testId="writing-focus-toggle"
        checked={focusMode}
        disabled={settingsLoading || updateSettings.isPending}
        onChange={handleFocusMode}
      />
      <ToggleRow
        id={autoSaveId}
        label="Auto-save"
        hint="Persist drafts automatically as you type"
        testId="writing-autosave-toggle"
        checked={autoSave}
        onChange={setAutoSave}
      />
      <ToggleRow
        id={smartQuotesId}
        label="Smart quotes"
        hint="Convert straight quotes into curly quotes as you type"
        testId="writing-smart-quotes-toggle"
        checked={smartQuotes}
        disabled={settingsLoading || updateSettings.isPending}
        onChange={handleSmartQuotes}
      />
      <ToggleRow
        id={emDashId}
        label="Em-dash expansion"
        hint="Expand `--` into an em dash automatically"
        testId="writing-em-dash-toggle"
        checked={emDashExpansion}
        disabled={settingsLoading || updateSettings.isPending}
        onChange={handleEmDashExpansion}
      />

      <div className="flex flex-col gap-1" data-testid="writing-daily-goal-row">
        <label htmlFor={dailyGoalId} className="flex items-baseline justify-between text-[12px]">
          <span className="font-medium text-ink-2">Daily goal</span>
          <span className="text-ink-4 font-sans">Words per day</span>
        </label>
        <input
          id={dailyGoalId}
          data-testid="writing-daily-goal-input"
          type="number"
          min={0}
          max={100000}
          step={100}
          value={goalDraft}
          disabled={settingsLoading}
          onChange={(e) => {
            handleGoalChange(e.target.value);
          }}
          className="w-32 px-3 py-2 text-[13px] font-mono border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3"
        />
      </div>
    </div>
  );
}
