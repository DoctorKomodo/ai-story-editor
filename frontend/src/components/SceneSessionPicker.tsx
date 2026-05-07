import { type JSX, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

export interface SceneSession {
  id: string;
  title: string;
  updatedAt: string;
}

export interface SceneSessionPickerProps {
  sessions: SceneSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const m = Math.round(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'Yesterday';
  return `${d} days ago`;
}

function ChevronDownIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-shrink-0 text-ink-4"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function PlusIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PencilIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function SceneSessionPicker({
  sessions,
  activeSessionId,
  onSelect,
  onRename,
  onDelete,
  onNew,
}: SceneSessionPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // [B2] Tracks whether the current rename was cancelled (Escape) so that the
  // subsequent blur event (which fires after Escape in real browsers) is a no-op.
  const cancelledRef = useRef(false);

  const active = sessions.find((s) => s.id === activeSessionId) ?? null;

  useEffect(() => {
    if (renamingId !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingId]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent): void => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      setOpen(false);
      setRenamingId(null);
    };

    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        setRenamingId(null);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const beginRename = useCallback((s: SceneSession): void => {
    cancelledRef.current = false;
    setRenamingId(s.id);
    setRenameDraft(s.title);
  }, []);

  const commitRename = useCallback((): void => {
    // [B2] If the rename was cancelled (Escape), the blur that fires right after
    // in real browsers must not commit the stale draft.
    if (cancelledRef.current) return;
    if (renamingId === null) return;
    const trimmed = renameDraft.trim();
    if (trimmed.length > 0) {
      onRename(renamingId, trimmed);
    }
    setRenamingId(null);
  }, [renamingId, renameDraft, onRename]);

  const cancelRename = useCallback((): void => {
    cancelledRef.current = true;
    setRenamingId(null);
    setRenameDraft('');
  }, []);

  const onRenameKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // [B1] Stop the event from bubbling to the document-level keydown
        // listener (which would close the whole dropdown). Escape here should
        // only exit rename mode, not collapse the picker.
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        cancelRename();
      }
    },
    [commitRename, cancelRename],
  );

  return (
    <div ref={containerRef} className="px-3 py-2 border-b border-line bg-bg relative">
      <button
        type="button"
        aria-label={active ? `Scene session: ${active.title}` : 'Scene session: none selected'}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="flex items-center gap-2 w-full px-2 py-1 rounded text-left hover:bg-surface-hover"
      >
        <span className="text-[10px] uppercase tracking-[.08em] text-ink-4 font-sans flex-shrink-0">
          SCENE
        </span>
        <span className="font-mono text-[12px] text-ink truncate flex-1 min-w-0">
          {active?.title ?? 'No session yet'}
        </span>
        {active !== null && (
          <span className="text-[11px] font-mono text-ink-4 flex-shrink-0">
            {relativeAge(active.updatedAt)}
          </span>
        )}
        <ChevronDownIcon />
      </button>

      {open && (
        <div
          className="absolute left-3 right-3 top-[calc(100%-2px)] z-10 bg-bg border border-line rounded shadow-pop overflow-hidden"
          role="listbox"
          aria-label="Scene sessions"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-[.08em] text-ink-4 font-sans border-b border-line bg-bg-sunken">
            Scenes in this chapter
          </div>

          {sessions.map((s) => (
            <div
              key={s.id}
              role="option"
              tabIndex={0}
              aria-selected={s.id === activeSessionId}
              aria-label={s.title}
              onClick={() => {
                if (renamingId !== s.id) {
                  onSelect(s.id);
                  setOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renamingId !== s.id) {
                  onSelect(s.id);
                  setOpen(false);
                }
              }}
              className={[
                'group flex items-center gap-2 px-3 py-2 hover:bg-surface-hover cursor-pointer',
                s.id === activeSessionId ? 'bg-accent-soft' : '',
              ]
                .join(' ')
                .trim()}
            >
              <div className="flex flex-col flex-1 min-w-0">
                {renamingId === s.id ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={renameDraft}
                    onChange={(e) => {
                      setRenameDraft(e.target.value);
                    }}
                    onBlur={commitRename}
                    onKeyDown={onRenameKey}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    className="bg-transparent border border-line rounded px-1 text-[13px] text-ink focus:outline-none"
                  />
                ) : (
                  <span className="text-[13px] text-ink truncate">{s.title}</span>
                )}
                <span className="text-[11px] font-mono text-ink-4">{relativeAge(s.updatedAt)}</span>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  beginRename(s);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-ink-3 hover:text-ink-2 hover:bg-surface-hover"
                aria-label={`Rename ${s.title}`}
                title="Rename"
              >
                <PencilIcon />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-ink-3 hover:text-danger hover:bg-surface-hover"
                aria-label={`Delete ${s.title}`}
                title="Delete"
              >
                <TrashIcon />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              onNew();
              setOpen(false);
            }}
            className="flex items-center gap-2 w-full px-3 py-2 border-t border-line text-[13px] text-ink-2 hover:bg-surface-hover"
          >
            <PlusIcon />
            New scene
          </button>
        </div>
      )}
    </div>
  );
}
