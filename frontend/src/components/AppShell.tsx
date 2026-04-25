// [F25] App shell — pure-presentational grid scaffold.
//
// Three-column CSS grid with named areas, mirroring the mockup's `.app` rule
// (mockups/frontend-prototype/design/styles.css lines 117–139). The grid
// definition + `data-layout` overrides live in `frontend/src/index.css` under
// `.app-shell` because Tailwind's arbitrary-value utilities don't cover
// `grid-template-areas` cleanly.
//
// Layout state lives on `useTweaksStore` ([F22]). The shell only reads it.
// Slot props are rendered as-is; F26/F27/F38 fill them in.
//
// Keyboard shortcut: `Cmd/Ctrl+Shift+F` toggles focus mode. F47 will fold this
// into the central `useKeyboardShortcuts` registry; for now it's a single
// document-level listener mounted by the shell.
import { type ReactElement, type ReactNode, useEffect } from 'react';
import { useFocusToggle } from '@/hooks/useFocusToggle';
import { useTweaksStore } from '@/store/tweaks';

export interface AppShellProps {
  topbar: ReactNode;
  sidebar: ReactNode;
  editor: ReactNode;
  chat: ReactNode;
}

export function AppShell({ topbar, sidebar, editor, chat }: AppShellProps): ReactElement {
  const layout = useTweaksStore((s) => s.tweaks.layout);
  const { toggleFocus } = useFocusToggle();

  // [F25] Cmd/Ctrl+Shift+F — focus-mode toggle. F47 owns the central registry;
  // until then this listener lives here. Reserved keys (`Cmd/Ctrl+Enter`,
  // `Alt+Enter`, `Escape`) are intentionally avoided per CLAUDE.md.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        toggleFocus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggleFocus]);

  return (
    <div className="app-shell bg-bg text-ink" data-layout={layout} data-testid="app-shell">
      <header className="topbar" data-testid="app-shell-topbar">
        {topbar}
      </header>
      <aside className="sidebar" data-testid="app-shell-sidebar">
        {sidebar}
      </aside>
      <main className="editor" data-testid="app-shell-editor">
        {editor}
      </main>
      <aside className="chat" data-testid="app-shell-chat">
        {chat}
      </aside>
    </div>
  );
}
