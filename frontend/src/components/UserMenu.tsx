import type { JSX } from 'react';
/**
 * [F17] User menu disclosure (visual surface redesigned in [F26]).
 *
 * Renders a 26px circular initial-avatar that opens a 220px popup menu.
 * The header shows the username + `@username` (mono); items are Settings,
 * Your stories, Account & privacy, divider, Sign out (danger). Clicking
 * outside or pressing Escape closes the menu.
 *
 * The data flow + sign-out callback contract are stable from [F17]. The
 * extra `onOpen*` callbacks added in [F26] are optional — the modals they
 * trigger ([F30] stories list, [F43] settings, future Account & privacy)
 * aren't wired yet, so leaving them undefined renders the items as
 * disabled-style no-ops.
 */
import { useEffect, useRef, useState } from 'react';
import type { VeniceAccount } from '@/hooks/useVeniceAccount';
import { BalanceDisplay } from './BalanceDisplay';

export interface UserMenuProps {
  username: string;
  onSignOut: () => void;
  balance: VeniceAccount | null;
  isLoading?: boolean;
  isError?: boolean;
  errorCode?: string | null;
  // [F26] visual additions — callbacks below are optional because their
  // modals/panels haven't shipped yet ([F43] Settings, [F30] Stories list,
  // future Account & privacy). When undefined the menu item is still
  // rendered (matches the mockup) but is a no-op on click.
  displayName?: string | null;
  userInitial?: string | null;
  onOpenSettings?: () => void;
  onOpenStoriesList?: () => void;
  onOpenAccount?: () => void;
}

function GearIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
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

function BookIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
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

function ShieldIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function XIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface MenuItemProps {
  icon: JSX.Element;
  label: string;
  onClick?: () => void;
  danger?: boolean;
}

function MenuItem({ icon, label, onClick, danger = false }: MenuItemProps): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13px]',
        'transition-colors hover:bg-surface-hover',
        danger ? 'text-danger' : 'text-ink-2',
      ].join(' ')}
    >
      <span
        className={[
          'flex h-3.5 w-3.5 items-center justify-center',
          danger ? 'text-danger' : 'text-ink-4',
        ].join(' ')}
        aria-hidden="true"
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

export function UserMenu({
  username,
  onSignOut,
  balance,
  isLoading = false,
  isError = false,
  errorCode = null,
  displayName = null,
  userInitial = null,
  onOpenSettings,
  onOpenStoriesList,
  onOpenAccount,
}: UserMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const initial =
    userInitial && userInitial.length > 0
      ? userInitial.charAt(0).toUpperCase()
      : username.charAt(0).toUpperCase();
  const headerName = displayName ?? username;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-menu-panel"
        aria-label={username}
        onClick={() => {
          setOpen((v) => !v);
        }}
        className={[
          'grid h-[26px] w-[26px] place-items-center rounded-full',
          'border border-line-2 bg-accent-soft text-ink-2',
          'font-serif italic text-[12px] leading-none',
          'transition-colors hover:bg-surface-hover',
        ].join(' ')}
      >
        {initial}
      </button>

      {open ? (
        <div
          id="user-menu-panel"
          role="menu"
          aria-label="User menu"
          className={[
            'absolute right-0 top-[34px] z-[61] w-[220px]',
            'rounded-lg border border-line-2 bg-bg-elevated p-1.5 shadow-pop',
            'font-sans',
          ].join(' ')}
        >
          <div className="mb-1 border-b border-line px-2.5 py-2">
            <div className="text-[13px] font-medium text-ink">{headerName}</div>
            <div className="font-mono text-[11px] text-ink-4">@{username}</div>
          </div>

          {/* Balance section preserved from [F17]. */}
          <div className="border-b border-line px-2.5 py-2">
            <BalanceDisplay
              balance={balance}
              isLoading={isLoading}
              isError={isError}
              errorCode={errorCode}
            />
          </div>

          <div className="pt-1">
            <MenuItem
              icon={<GearIcon />}
              label="Settings"
              onClick={() => {
                setOpen(false);
                // TODO: [F43] open Settings modal
                onOpenSettings?.();
              }}
            />
            <MenuItem
              icon={<BookIcon />}
              label="Your stories"
              onClick={() => {
                setOpen(false);
                // TODO: [F30] open Stories list modal
                onOpenStoriesList?.();
              }}
            />
            <MenuItem
              icon={<ShieldIcon />}
              label="Account & privacy"
              onClick={() => {
                setOpen(false);
                // TODO: future Account & privacy panel
                onOpenAccount?.();
              }}
            />
            <div className="my-1 border-t border-line" />
            <MenuItem
              icon={<XIcon />}
              label="Sign out"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              danger
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
