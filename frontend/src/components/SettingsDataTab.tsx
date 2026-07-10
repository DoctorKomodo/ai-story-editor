import { type JSX, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  EXPORT_FORMAT_VERSION,
  type ImportFile,
  type ImportResolution,
  type ImportResult,
  importSchema,
} from 'story-editor-shared';
import { Checkbox } from '@/design/primitives';
import { useExportBackup, useImportBackup, useImportPlan } from '@/hooks/useBackup';

const CONFIRM_PHRASE = 'replace these stories';

type Bucket = 'new' | 'unchanged' | 'conflict';

interface StoryRow {
  index: number;
  title: string;
  id: string | undefined;
  bucket: Bucket;
}

const BUCKET_LABEL: Record<Bucket, string> = {
  new: 'New',
  unchanged: 'Unchanged',
  conflict: 'Conflict',
};

function defaultResolutionFor(bucket: Bucket): ImportResolution {
  return bucket === 'unchanged' ? 'skip' : 'create';
}

export function SettingsDataTab(): JSX.Element {
  const confirmId = useId();
  const navigate = useNavigate();
  const exporter = useExportBackup();
  const importPlan = useImportPlan();
  const importer = useImportBackup();

  const [staged, setStaged] = useState<ImportFile | null>(null);
  const [rows, setRows] = useState<StoryRow[]>([]);
  const [resolutions, setResolutions] = useState<Record<number, ImportResolution>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState('');
  const [safetyBackup, setSafetyBackup] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [resultTitles, setResultTitles] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');

  // Guards a late plan/parse resolve landing after a newer file has already
  // been picked — same pattern as EditorPage's `seededForChapterIdRef` /
  // useChapterDraft's `currentChapterKeyRef`.
  const fileSelectionRef = useRef(0);

  // Clear the displayed filename and reset the native input so re-picking the
  // same (rejected) file still re-fires onChange.
  function clearFileSelection(): void {
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function resetForNewFile(): void {
    setFileError(null);
    setRestoreError(null);
    setResult(null);
    setResultTitles([]);
    setStaged(null);
    setRows([]);
    setResolutions({});
    setPhrase('');
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const selection = ++fileSelectionRef.current;
    resetForNewFile();
    const f = e.target.files?.[0];
    if (!f) {
      setFileName('');
      return;
    }
    setFileName(f.name);

    let parsed: ImportFile;
    try {
      const raw: unknown = JSON.parse(await f.text());
      const parseResult = importSchema.safeParse(raw);
      if (selection !== fileSelectionRef.current) return;
      if (!parseResult.success) {
        // A version mismatch buries the real cause under dozens of strict-schema
        // issues — name it explicitly instead of "not a valid backup".
        const version = (raw as { formatVersion?: unknown } | null)?.formatVersion;
        setFileError(
          typeof version === 'number' && version !== EXPORT_FORMAT_VERSION
            ? `This backup uses format version ${version}; this app only reads version ${EXPORT_FORMAT_VERSION} backups. It was exported by a different app version and cannot be imported.`
            : 'That file is not a valid Inkwell backup.',
        );
        clearFileSelection();
        return;
      }
      parsed = parseResult.data;
    } catch {
      if (selection !== fileSelectionRef.current) return;
      setFileError('Could not read that file as JSON.');
      clearFileSelection();
      return;
    }

    setStaged(parsed);

    // Only stories carrying BOTH fields can be matched against live data —
    // everything else (legacy files, or a story missing one of the two)
    // buckets as `new` without a round trip.
    const planCandidates = parsed.stories
      .map((s, index) => ({ index, id: s.id, snapshotUpdatedAt: s.snapshotUpdatedAt }))
      .filter(
        (s): s is { index: number; id: string; snapshotUpdatedAt: string } =>
          s.id !== undefined && s.snapshotUpdatedAt !== undefined,
      );

    let statusById = new Map<string, Bucket>();
    if (planCandidates.length > 0) {
      try {
        const plan = await importPlan.mutateAsync({
          stories: planCandidates.map(({ id, snapshotUpdatedAt }) => ({ id, snapshotUpdatedAt })),
        });
        if (selection !== fileSelectionRef.current) return;
        statusById = new Map(plan.stories.map((s) => [s.id, s.status]));
      } catch {
        if (selection !== fileSelectionRef.current) return;
        setFileError('Could not check this file against your existing stories. Please try again.');
        clearFileSelection();
        setStaged(null);
        return;
      }
    }

    const newRows: StoryRow[] = parsed.stories.map((s, index) => ({
      index,
      title: s.title,
      id: s.id,
      bucket: s.id ? (statusById.get(s.id) ?? 'new') : 'new',
    }));
    setRows(newRows);
    setResolutions(
      Object.fromEntries(newRows.map((r) => [r.index, defaultResolutionFor(r.bucket)])),
    );
  }

  function setResolutionFor(index: number, value: ImportResolution): void {
    setResolutions((prev) => ({ ...prev, [index]: value }));
  }

  const hasReplace = Object.values(resolutions).some((r) => r === 'replace');

  // Re-entrancy guard for the whole restore span (safety export + import),
  // not just `importer.isPending` — the safety export can run for seconds
  // before the import call even starts, and a second Restore click landing
  // in that window must not fire a second submission.
  async function onRestore(): Promise<void> {
    if (restoring) return;
    if (!staged) return;
    setRestoring(true);
    try {
      setRestoreError(null);

      // Guards against a re-pick landing while this restore is still in flight —
      // same pattern as `fileSelectionRef` in `onFileChange`. The picker controls
      // are disabled on `restoring`, so this is defense in depth for a
      // path that bypasses the disabled control (keyboard, programmatic).
      const generation = fileSelectionRef.current;

      // A failed safety export aborts the restore — never delete content we couldn't back up.
      // Only relevant when a replace is in play; create/skip never delete anything.
      if (hasReplace && safetyBackup) {
        try {
          await exporter.download();
        } catch {
          setRestoreError(
            'Could not download the safety backup, so the restore was cancelled. Your content was not changed.',
          );
          return;
        }
      }

      const resolutionsPayload: Record<string, ImportResolution> = {};
      for (const row of rows) {
        if (row.id)
          resolutionsPayload[row.id] = resolutions[row.index] ?? defaultResolutionFor(row.bucket);
      }

      let outcome: ImportResult;
      try {
        outcome = await importer.mutateAsync({ file: staged, resolutions: resolutionsPayload });
      } catch (err) {
        setRestoreError(
          err instanceof Error && err.message
            ? `Restore failed: ${err.message}`
            : 'Restore failed. Please try again.',
        );
        return;
      }

      setResult(outcome);
      setResultTitles(rows.map((r) => r.title));
      // A newer file selection happened while this restore was in flight — leave
      // its already-staged rows/resolutions/filename alone.
      if (generation !== fileSelectionRef.current) return;
      setStaged(null);
      setRows([]);
      setResolutions({});
      setFileName('');
      setPhrase('');
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setRestoring(false);
    }
  }

  const canRestore =
    staged !== null &&
    !restoring &&
    !importPlan.isPending &&
    !importer.isPending &&
    (!hasReplace || phrase === CONFIRM_PHRASE);

  const outcomes = result?.outcomes ?? [];
  const createdCount = outcomes.filter((o) => o.action === 'created').length;
  const replacedCount = outcomes.filter((o) => o.action === 'replaced').length;
  const skippedCount = outcomes.filter((o) => o.action === 'skipped').length;
  const failedOutcome = outcomes.find((o) => o.action === 'failed');
  const notAttemptedCount = result ? resultTitles.length - outcomes.length : 0;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" data-testid="data-section-export">
        <header>
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Export</h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Download all your stories, chapters, characters, and chat history as a JSON file.
          </p>
        </header>

        <button
          type="button"
          data-testid="data-export-btn"
          disabled={exporter.isPending}
          onClick={() => {
            void exporter.download();
          }}
          className="w-fit px-3 py-1.5 text-[12px] rounded-[var(--radius)] bg-ink text-bg hover:bg-ink-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporter.isPending ? 'Exporting…' : 'Export my content'}
        </button>
      </section>

      <section className="flex flex-col gap-3" data-testid="data-section-restore">
        <header>
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">Import backup</h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Import a previously exported Inkwell backup. Importing never deletes stories that
            aren&rsquo;t in the file — matched stories are imported as a new copy unless you
            explicitly choose to replace them.
          </p>
        </header>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-2">Backup file</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              data-testid="data-restore-file"
              disabled={restoring || importer.isPending}
              onChange={(e) => {
                void onFileChange(e);
              }}
              className="sr-only"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="data-restore-browse"
                disabled={restoring || importer.isPending}
                onClick={() => fileRef.current?.click()}
                className="w-fit px-3 py-1.5 text-[12px] rounded-[var(--radius)] border border-line text-ink-2 bg-bg hover:bg-[color:var(--surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Choose file…
              </button>
              <span className="text-[12px] font-sans text-ink-4 truncate">
                {fileName || 'No file selected'}
              </span>
            </div>
          </div>

          {fileError ? (
            <p
              role="alert"
              data-testid="data-restore-error"
              className="text-[12px] font-mono text-[color:var(--danger)]"
            >
              {fileError}
            </p>
          ) : null}

          {importPlan.isPending ? (
            <p data-testid="data-restore-plan-pending" className="text-[12px] font-sans text-ink-4">
              Checking this file against your existing stories…
            </p>
          ) : null}

          {staged ? (
            <div
              data-testid="data-restore-summary"
              className="rounded-[var(--radius)] border border-line bg-bg p-3 flex flex-col gap-2"
            >
              <p className="text-[12px] font-sans text-ink-2">
                This file contains{' '}
                <strong className="text-ink">
                  {staged.stories.length} {staged.stories.length === 1 ? 'story' : 'stories'}
                </strong>
                .
              </p>

              {rows.map((row) => (
                <div
                  key={row.index}
                  data-testid={`data-restore-row-${row.index}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[12px] font-sans text-ink truncate">{row.title}</span>
                    <span
                      data-testid={`data-restore-bucket-${row.index}`}
                      className="text-[11px] font-mono uppercase text-ink-4 px-1.5 py-0.5 rounded-[var(--radius)] border border-line shrink-0"
                    >
                      {BUCKET_LABEL[row.bucket]}
                    </span>
                  </div>
                  <select
                    data-testid={`data-restore-resolution-${row.index}`}
                    aria-label={`Resolution for "${row.title}"`}
                    value={resolutions[row.index] ?? defaultResolutionFor(row.bucket)}
                    disabled={restoring || importer.isPending}
                    onChange={(e) => {
                      setResolutionFor(row.index, e.target.value as ImportResolution);
                    }}
                    className="px-2 py-1 text-[12px] font-sans border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="create">
                      {row.bucket === 'conflict' ? 'Keep both' : 'Import as new'}
                    </option>
                    {row.bucket !== 'new' ? (
                      <option value="replace">Replace existing story</option>
                    ) : null}
                    <option value="skip">Skip</option>
                  </select>
                </div>
              ))}
            </div>
          ) : null}

          {hasReplace ? (
            <>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps a <Checkbox> (a forwardRef'd <input type="checkbox">); biome can't trace the control through the custom component. */}
              <label className="flex items-center gap-2 text-[12px] text-ink-2 font-sans">
                <Checkbox
                  data-testid="data-restore-safety"
                  checked={safetyBackup}
                  disabled={restoring || importer.isPending}
                  onChange={(e) => {
                    setSafetyBackup(e.target.checked);
                  }}
                />
                Download a safety backup of my current content first
              </label>

              <p className="text-[12px] font-sans text-[color:var(--danger)]">
                Replacing a story permanently deletes its current content first.
                {safetyBackup
                  ? ' A safety backup of your current content will be downloaded first.'
                  : ''}
              </p>

              <div className="flex flex-col gap-1">
                <label htmlFor={confirmId} className="text-[12px] font-medium text-ink-2">
                  Type &ldquo;{CONFIRM_PHRASE}&rdquo; to confirm
                </label>
                <input
                  id={confirmId}
                  data-testid="data-restore-phrase"
                  type="text"
                  value={phrase}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={CONFIRM_PHRASE}
                  disabled={restoring || importer.isPending}
                  onChange={(e) => {
                    setPhrase(e.target.value);
                  }}
                  className="w-64 px-3 py-2 text-[13px] font-mono border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            </>
          ) : null}

          <button
            type="button"
            data-testid="data-restore-btn"
            disabled={!canRestore}
            onClick={() => {
              void onRestore();
            }}
            className="w-fit px-3 py-1.5 text-[12px] rounded-[var(--radius)] border border-line text-[color:var(--danger)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {restoring ? 'Restoring…' : 'Restore'}
          </button>

          {restoreError ? (
            <p
              role="alert"
              data-testid="data-restore-failure"
              className="text-[12px] font-sans text-[color:var(--danger)]"
            >
              {restoreError}
            </p>
          ) : null}

          {result ? (
            <div
              data-testid="data-restore-result"
              className="rounded-[var(--radius)] border border-line bg-bg p-3 flex flex-col gap-1"
            >
              <p className="text-[12px] font-sans text-ink-2">
                Import finished: {createdCount} created, {replacedCount} replaced, {skippedCount}{' '}
                skipped{failedOutcome ? ', 1 failed' : ''}.
              </p>
              {failedOutcome ? (
                <p
                  role="alert"
                  data-testid="data-restore-result-failure"
                  className="text-[12px] font-mono text-[color:var(--danger)]"
                >
                  Import stopped after &ldquo;
                  {resultTitles[failedOutcome.index] ?? `story ${failedOutcome.index + 1}`}
                  &rdquo; failed to import.
                </p>
              ) : null}
              {notAttemptedCount > 0 ? (
                <p
                  data-testid="data-restore-result-not-attempted"
                  className="text-[12px] font-sans text-ink-4"
                >
                  {notAttemptedCount} {notAttemptedCount === 1 ? 'story was' : 'stories were'} not
                  attempted.
                </p>
              ) : null}
              <button
                type="button"
                data-testid="data-restore-result-done"
                onClick={() => navigate('/')}
                className="w-fit px-3 py-1.5 text-[12px] rounded-[var(--radius)] bg-ink text-bg hover:bg-ink-2 transition-colors"
              >
                Go to library
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
