import type { JSX } from 'react';
/**
 * [F17] Minimal user menu disclosure.
 *
 * Renders a button labelled with the username; on click, a small popup
 * reveals the Venice account balance and a Sign out action. Clicking
 * outside or pressing Escape closes the menu.
 *
 * F26 replaces the visual surface with the mockup spec (26px avatar,
 * 220px dropdown, etc.) — the data flow and callback contract here are
 * intentionally stable so F26 is layout-only.
 */
import { useEffect, useRef, useState } from 'react';
import type { Balance } from '@/hooks/useBalance';
import { BalanceDisplay } from './BalanceDisplay';

export interface UserMenuProps {
  username: string;
  onSignOut: () => void;
  balance: Balance | null;
  isLoading?: boolean;
  isError?: boolean;
  errorCode?: string | null;
}

export function UserMenu({
  username,
  onSignOut,
  balance,
  isLoading = false,
  isError = false,
  errorCode = null,
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

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-menu-panel"
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors"
      >
        {username}
      </button>

      {open ? (
        <div
          id="user-menu-panel"
          role="menu"
          aria-label="User menu"
          className="absolute right-0 mt-1 w-56 rounded border border-neutral-200 bg-white p-3 shadow-md z-10 space-y-3"
        >
          <BalanceDisplay
            balance={balance}
            isLoading={isLoading}
            isError={isError}
            errorCode={errorCode}
          />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSignOut();
            }}
            className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
