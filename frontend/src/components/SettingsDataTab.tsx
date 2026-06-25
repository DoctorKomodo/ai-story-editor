import { type JSX, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ImportFile, importSchema } from 'story-editor-shared';
import { useExportBackup, useImportBackup } from '@/hooks/useBackup';

const CONFIRM_PHRASE = 'replace everything';

export function SettingsDataTab(): JSX.Element {
  const confirmId = useId();
  const navigate = useNavigate();
  const exporter = useExportBackup();
  const importer = useImportBackup();
  const [staged, setStaged] = useState<ImportFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState('');
  const [safetyBackup, setSafetyBackup] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    setParseError(null);
    setStaged(null);
    setPhrase('');
    const f = e.target.files?.[0];
    if (!f) {
      setFileName('');
      return;
    }
    setFileName(f.name);
    try {
      const parsed = importSchema.safeParse(JSON.parse(await f.text()));
      if (!parsed.success) {
        setParseError('That file is not a valid Inkwell backup.');
        clearFileSelection();
        return;
      }
      setStaged(parsed.data);
    } catch {
      setParseError('Could not read that file as JSON.');
      clearFileSelection();
    }
  }

  // Clear the displayed filename and reset the native input so re-picking the
  // same (rejected) file still re-fires onChange.
  function clearFileSelection(): void {
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function onRestore(): Promise<void> {
    if (!staged) return;
    if (safetyBackup) await exporter.download();
    await importer.mutateAsync(staged);
    setStaged(null);
    setFileName('');
    setPhrase('');
    if (fileRef.current) fileRef.current.value = '';
    navigate('/');
  }

  const canRestore = staged !== null && phrase === CONFIRM_PHRASE && !importer.isPending;
  const counts = staged
    ? {
        stories: staged.stories.length,
        chapters: staged.stories.reduce((n, s) => n + s.chapters.length, 0),
      }
    : null;

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
          <h3 className="m-0 font-serif text-[14px] font-medium text-ink">
            Restore (replaces everything)
          </h3>
          <p className="mt-[2px] text-[12px] text-ink-4 font-sans">
            Import a previously exported Inkwell backup. This permanently deletes all current
            stories and content first.
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
              onChange={(e) => {
                void onFileChange(e);
              }}
              className="sr-only"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="data-restore-browse"
                onClick={() => fileRef.current?.click()}
                className="w-fit px-3 py-1.5 text-[12px] rounded-[var(--radius)] border border-line text-ink-2 bg-bg hover:bg-[color:var(--surface-hover)] transition-colors"
              >
                Choose file…
              </button>
              <span className="text-[12px] font-sans text-ink-4 truncate">
                {fileName || 'No file selected'}
              </span>
            </div>
          </div>

          {parseError ? (
            <p
              role="alert"
              data-testid="data-restore-error"
              className="text-[12px] font-mono text-[color:var(--danger)]"
            >
              {parseError}
            </p>
          ) : null}

          {counts ? (
            <div
              data-testid="data-restore-summary"
              className="rounded-[var(--radius)] border border-line bg-bg p-3 flex flex-col gap-1"
            >
              <p className="text-[12px] font-sans text-ink-2">
                This file contains{' '}
                <strong className="text-ink">
                  {counts.stories} {counts.stories === 1 ? 'story' : 'stories'}
                </strong>{' '}
                and{' '}
                <strong className="text-ink">
                  {counts.chapters} {counts.chapters === 1 ? 'chapter' : 'chapters'}
                </strong>
                .
              </p>
              <p className="text-[12px] font-sans text-[color:var(--danger)]">
                Restoring will permanently delete all current content.
                {safetyBackup
                  ? ' A safety backup of your current content will be downloaded first.'
                  : ''}
              </p>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-[12px] text-ink-2 font-sans">
            <input
              type="checkbox"
              data-testid="data-restore-safety"
              checked={safetyBackup}
              onChange={(e) => {
                setSafetyBackup(e.target.checked);
              }}
            />
            Download a safety backup of my current content first
          </label>

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
              onChange={(e) => {
                setPhrase(e.target.value);
              }}
              className="w-48 px-3 py-2 text-[13px] font-mono border border-line rounded-[var(--radius)] bg-bg focus:outline-none focus:border-ink-3"
            />
          </div>

          <button
            type="button"
            data-testid="data-restore-btn"
            disabled={!canRestore}
            onClick={() => {
              void onRestore();
            }}
            className="w-fit px-3 py-1.5 text-[12px] rounded-[var(--radius)] border border-line text-[color:var(--danger)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importer.isPending ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      </section>
    </div>
  );
}
