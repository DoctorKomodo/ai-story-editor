// [F27] Sidebar shell — header (story-picker + add), tabs row, scrollable
// body, progress footer. Faithful port of `mockups/frontend-prototype/design/
// sidebar.jsx` and the `.sidebar / .sidebar-header / .story-picker /
// .sidebar-tabs / .sidebar-tab / .sidebar-body` rules in
// `mockups/frontend-prototype/design/styles.css` (lines 222–355).
//
// Tab state lives on `useSidebarTabStore` ([F22]). F27 owns the shell only —
// the tab body bodies (Chapters / Cast / Outline) are passed in via props by
// the parent; F10 `<ChapterList>` is the chapters body, F28 / F29 fill the
// other two.
import type { JSX, ReactNode } from 'react';
import { type SidebarTab, useSidebarTabStore } from '@/store/sidebarTab';

export interface SidebarProps {
  storyTitle?: string | null;
  totalWordCount?: number;
  goalWordCount?: number;
  onOpenStoryPicker?: () => void;
  /** Render `N` under the CHAPTERS label. `null` ⇒ count line hidden (loading). */
  chaptersCount?: number | null;
  /** Render `N` under the CAST label. `null` ⇒ count line hidden. */
  castCount?: number | null;
  chaptersBody: ReactNode;
  castBody?: ReactNode;
  outlineBody?: ReactNode;
}

function BookIcon(): JSX.Element {
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
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function ChevronDownIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

interface TabSpec {
  id: SidebarTab;
  label: string;
  panelId: string;
  tabId: string;
}

const TABS: readonly TabSpec[] = [
  {
    id: 'chapters',
    label: 'Chapters',
    panelId: 'sidebar-panel-chapters',
    tabId: 'sidebar-tab-chapters',
  },
  { id: 'cast', label: 'Cast', panelId: 'sidebar-panel-cast', tabId: 'sidebar-tab-cast' },
  {
    id: 'outline',
    label: 'Outline',
    panelId: 'sidebar-panel-outline',
    tabId: 'sidebar-tab-outline',
  },
] as const;

export function Sidebar({
  storyTitle = null,
  totalWordCount,
  goalWordCount,
  onOpenStoryPicker,
  chaptersCount = null,
  castCount = null,
  chaptersBody,
  castBody = null,
  outlineBody = null,
}: SidebarProps): JSX.Element {
  const activeTab = useSidebarTabStore((s) => s.sidebarTab);
  const setSidebarTab = useSidebarTabStore((s) => s.setSidebarTab);

  const titleLabel = storyTitle != null && storyTitle.length > 0 ? storyTitle : 'No story';

  const words =
    typeof totalWordCount === 'number' && Number.isFinite(totalWordCount) ? totalWordCount : 0;
  const goal =
    typeof goalWordCount === 'number' && Number.isFinite(goalWordCount) && goalWordCount > 0
      ? goalWordCount
      : null;
  const percent = goal != null ? Math.min(100, Math.max(0, Math.round((words / goal) * 100))) : 0;

  return (
    <aside
      className="sidebar flex h-full min-h-0 min-w-[260px] flex-col overflow-hidden border-r border-line bg-bg"
      data-testid="sidebar"
    >
      {/* Header */}
      <div
        className="sidebar-header flex items-center justify-between gap-1.5 px-3 pt-2.5 pb-2"
        data-testid="sidebar-header"
      >
        <button
          type="button"
          className="story-picker flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[var(--radius)] px-2 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-[var(--surface-hover)]"
          onClick={onOpenStoryPicker}
          aria-label="Switch story"
          data-testid="sidebar-story-picker"
        >
          <span className="text-ink-3" aria-hidden="true">
            <BookIcon />
          </span>
          <span className="title flex-1 overflow-hidden text-left text-ellipsis whitespace-nowrap">
            {titleLabel}
          </span>
          <span className="chev flex-shrink-0 text-ink-4" aria-hidden="true">
            <ChevronDownIcon />
          </span>
        </button>
      </div>

      {/* Tabs */}
      <div
        className="sidebar-tabs flex border-b border-line px-3"
        role="tablist"
        aria-label="Sidebar sections"
      >
        {TABS.map((t) => {
          const isActive = activeTab === t.id;
          const count = t.id === 'chapters' ? chaptersCount : t.id === 'cast' ? castCount : null;
          const ariaLabel = count !== null ? `${t.label} (${String(count)})` : undefined;
          return (
            <button
              key={t.id}
              id={t.tabId}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={t.panelId}
              aria-label={ariaLabel}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setSidebarTab(t.id)}
              className={[
                'sidebar-tab relative flex flex-col items-center px-2.5 py-2 font-sans text-[12px] tracking-[.02em] uppercase transition-colors',
                isActive
                  ? "text-ink after:absolute after:right-2.5 after:bottom-[-1px] after:left-2.5 after:h-px after:bg-ink after:content-['']"
                  : 'text-ink-4 hover:text-ink-2',
              ].join(' ')}
              data-testid={`sidebar-tab-${t.id}`}
            >
              <span>{t.label}</span>
              {count !== null ? (
                <span
                  className={[
                    'font-mono text-[11px] tabular-nums',
                    isActive ? 'text-ink-3' : 'text-ink-4',
                  ].join(' ')}
                >
                  {String(count)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="sidebar-body flex-1 overflow-y-auto py-2" data-testid="sidebar-body">
        <div
          role="tabpanel"
          id="sidebar-panel-chapters"
          aria-labelledby="sidebar-tab-chapters"
          hidden={activeTab !== 'chapters'}
          data-testid="sidebar-panel-chapters"
        >
          {chaptersBody}
        </div>
        <div
          role="tabpanel"
          id="sidebar-panel-cast"
          aria-labelledby="sidebar-tab-cast"
          hidden={activeTab !== 'cast'}
          data-testid="sidebar-panel-cast"
        >
          {castBody ?? (
            <div
              className="px-3 py-2 text-[12px] text-ink-4"
              data-testid="sidebar-cast-placeholder"
            >
              Coming in [F28]
            </div>
          )}
        </div>
        <div
          role="tabpanel"
          id="sidebar-panel-outline"
          aria-labelledby="sidebar-tab-outline"
          hidden={activeTab !== 'outline'}
          data-testid="sidebar-panel-outline"
        >
          {outlineBody ?? (
            <div
              className="px-3 py-2 text-[12px] text-ink-4"
              data-testid="sidebar-outline-placeholder"
            >
              Coming in [F29]
            </div>
          )}
        </div>
      </div>

      {/* Progress footer */}
      <footer
        className="sidebar-footer border-t border-line px-3 py-2.5"
        data-testid="sidebar-footer"
      >
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-ink-4 [font-variant-numeric:tabular-nums]">
          {goal != null ? (
            <span data-testid="sidebar-progress-text">
              {words.toLocaleString()} / {goal.toLocaleString()} words · {percent}%
            </span>
          ) : (
            <span data-testid="sidebar-progress-text">{words.toLocaleString()} words</span>
          )}
        </div>
        {goal != null ? (
          <div
            className="mt-1.5 h-0.5 w-full bg-line"
            role="progressbar"
            aria-label="Story progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            data-testid="sidebar-progress-bar"
          >
            <div
              className="h-full bg-ink"
              style={{ width: `${percent}%` }}
              data-testid="sidebar-progress-fill"
            />
          </div>
        ) : null}
      </footer>
    </aside>
  );
}
