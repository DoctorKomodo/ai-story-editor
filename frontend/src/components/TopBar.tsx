// [F26] Top bar — brand · breadcrumbs · save indicator · word count · icon buttons · user menu.
//
// Faithful port of `mockups/frontend-prototype/design/app.jsx`'s `TopBar` and
// the `.topbar / .brand / .crumbs / .meta / .icon-btn` rules in
// `mockups/frontend-prototype/design/styles.css` (lines 141–220). The `.icon-btn`
// shared class lives in `frontend/src/index.css` because it'll be reused by
// F27, F31, F38 and friends.
//
// F26 is component-level only — wiring this into `EditorPage` happens after
// the sidebar and chat panes land (F27/F38).
import type { JSX, ReactNode } from 'react';
import type { Balance } from '@/hooks/useBalance';
import { useFocusToggle } from '@/hooks/useFocusToggle';
import { UserMenu } from './UserMenu';

export type SaveState = 'saved' | 'saving' | 'failed' | 'idle';

export interface TopBarProps {
  // Breadcrumbs (centre)
  storyTitle?: string | null;
  chapterNumber?: number | null;
  chapterTitle?: string | null;

  // Save indicator + word count
  saveState?: SaveState;
  /** Caller computes (e.g. "12s ago"); rendered after "Saved · ". */
  savedAtRelative?: string | null;
  wordCount?: number | null;

  // Icon-button callbacks
  onToggleHistory?: () => void;
  onOpenSettings?: () => void;

  // User menu
  username: string;
  displayName?: string | null;
  userInitial?: string | null;
  balance?: Balance | null;
  isBalanceLoading?: boolean;
  isBalanceError?: boolean;
  balanceErrorCode?: string | null;
  onOpenStoriesList?: () => void;
  onOpenAccount?: () => void;
  onSignOut: () => void;
}

function BrandMark(): JSX.Element {
  // Same feather glyph as the auth hero ([F24]).
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
      <line x1="16" y1="8" x2="2" y2="22" />
      <line x1="17.5" y1="15" x2="9" y2="15" />
    </svg>
  );
}

function HistoryIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <polyline points="3 3 3 8 8 8" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

function FocusIcon(): JSX.Element {
  // Compress-arrows-style glyph.
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

interface SaveIndicatorProps {
  state: SaveState;
  relative: string | null;
}

function SaveIndicator({ state, relative }: SaveIndicatorProps): JSX.Element | null {
  if (state === 'idle') return null;

  let dotClass = 'bg-[#6aa84f]'; // green
  let label: ReactNode = null;

  if (state === 'saved') {
    label = relative ? `Saved · ${relative}` : 'Saved';
  } else if (state === 'saving') {
    label = 'Saving…';
  } else if (state === 'failed') {
    dotClass = 'bg-danger';
    label = 'Save failed';
  }

  return (
    <span className="saved flex items-center gap-1.5 text-ink-4" data-save-state={state}>
      <span
        className={['dot inline-block h-1.5 w-1.5 rounded-full', dotClass].join(' ')}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

export function TopBar({
  storyTitle = null,
  chapterNumber = null,
  chapterTitle = null,
  saveState = 'idle',
  savedAtRelative = null,
  wordCount = null,
  onToggleHistory,
  onOpenSettings,
  username,
  displayName = null,
  userInitial = null,
  balance = null,
  isBalanceLoading = false,
  isBalanceError = false,
  balanceErrorCode = null,
  onOpenStoriesList,
  onOpenAccount,
  onSignOut,
}: TopBarProps): JSX.Element {
  const { toggleFocus, isFocus } = useFocusToggle();

  const hasCrumbs = storyTitle != null && storyTitle.length > 0;

  return (
    <header
      className={[
        'topbar relative z-10 flex items-center gap-4 bg-bg px-3.5',
        'border-b border-line',
      ].join(' ')}
      style={{ height: 44 }}
      data-testid="topbar"
    >
      {/* Brand cell — 244px min-width, right-bordered. */}
      <div
        className={[
          'brand flex h-full items-center gap-2',
          'min-w-[244px] pl-1 pr-4 mr-1',
          'border-r border-line',
          'font-serif italic text-base text-ink',
        ].join(' ')}
      >
        <span className="brand-mark grid h-5 w-5 place-items-center text-ink" aria-hidden="true">
          <BrandMark />
        </span>
        Inkwell
      </div>

      {/* Breadcrumbs — Story / Ch N / Chapter title. */}
      <nav
        aria-label="Breadcrumb"
        className="crumbs flex flex-1 items-center gap-2 font-sans text-[13px] text-ink-3"
      >
        {hasCrumbs ? (
          <>
            <span>{storyTitle}</span>
            {chapterNumber != null ? (
              <>
                <span className="sep text-ink-5" aria-hidden="true">
                  /
                </span>
                <span>Ch {chapterNumber}</span>
              </>
            ) : null}
            {chapterTitle != null && chapterTitle.length > 0 ? (
              <>
                <span className="sep text-ink-5" aria-hidden="true">
                  /
                </span>
                <span className="current text-ink">{chapterTitle}</span>
              </>
            ) : null}
          </>
        ) : null}
      </nav>

      {/* Right meta group. */}
      <div className="meta flex items-center gap-4 text-[12px] text-ink-3 [font-variant-numeric:tabular-nums]">
        <SaveIndicator state={saveState} relative={savedAtRelative} />

        {wordCount != null ? (
          <span className="font-mono text-[12px]">{wordCount.toLocaleString()} words</span>
        ) : null}

        <span className="text-ink-5" aria-hidden="true">
          |
        </span>

        <button
          type="button"
          className="icon-btn"
          aria-label="History"
          title="History"
          onClick={() => {
            // TODO: future history panel
            onToggleHistory?.();
          }}
        >
          <HistoryIcon />
        </button>
        <button
          type="button"
          className={['icon-btn', isFocus ? 'active' : ''].join(' ').trim()}
          aria-label="Focus"
          aria-pressed={isFocus}
          title="Focus mode"
          onClick={toggleFocus}
        >
          <FocusIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Settings"
          title="Settings"
          onClick={() => {
            // TODO: [F43] open Settings modal
            onOpenSettings?.();
          }}
        >
          <SettingsIcon />
        </button>

        <UserMenu
          username={username}
          displayName={displayName}
          userInitial={userInitial}
          balance={balance}
          isLoading={isBalanceLoading}
          isError={isBalanceError}
          errorCode={balanceErrorCode}
          onSignOut={onSignOut}
          onOpenSettings={onOpenSettings}
          onOpenStoriesList={onOpenStoriesList}
          onOpenAccount={onOpenAccount}
        />
      </div>
    </header>
  );
}
