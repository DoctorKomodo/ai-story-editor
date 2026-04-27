// [F54] Wirer for the F37 <CharacterPopover>.
//
// Page-root host that owns the popover's open/close state with a grace-timer
// state machine. Two enter sources:
//   - charRef hover via useCharRefHoverDispatcher (F36)
//   - Cast-tab card click via the imperative `openFor` ref method
//
// Hover sources get a 150 ms anchor-leave grace + a 200 ms popover-leave
// grace (cancelled on re-enter). Click sources are sticky — Escape /
// outside-click / Edit / a different anchor close them; hover-leave is
// ignored. Timings pinned by F37 author note.

import type { JSX, RefObject } from 'react';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CharacterPopover } from '@/components/CharacterPopover';
import { useCharactersQuery } from '@/hooks/useCharacters';
import { useCharRefHoverDispatcher } from '@/lib/tiptap-extensions';

const ANCHOR_LEAVE_GRACE_MS = 150;
const POPOVER_LEAVE_GRACE_MS = 200;

type Source = 'hover' | 'click';

interface OpenState {
  characterId: string;
  anchorEl: HTMLElement;
  source: Source;
}

export interface CharacterPopoverHostHandle {
  /** Open the popover anchored to `el`, source=`click`. */
  openFor(characterId: string, el: HTMLElement): void;
}

export interface CharacterPopoverHostProps {
  storyId: string;
  hostRef: RefObject<CharacterPopoverHostHandle | null>;
  /** Called with the character id when **Edit** is clicked. Wire to F19 sheet. */
  onEdit: (id: string) => void;
}

export function CharacterPopoverHost({
  storyId,
  hostRef,
  onEdit,
}: CharacterPopoverHostProps): JSX.Element {
  const { data: characters } = useCharactersQuery(storyId);
  const [open, setOpen] = useState<OpenState | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(
    (delayMs: number) => {
      cancelClose();
      closeTimerRef.current = setTimeout(() => {
        setOpen(null);
        closeTimerRef.current = null;
      }, delayMs);
    },
    [cancelClose],
  );

  const closeNow = useCallback(() => {
    cancelClose();
    setOpen(null);
  }, [cancelClose]);

  useImperativeHandle(
    hostRef,
    () => ({
      openFor: (characterId: string, el: HTMLElement) => {
        cancelClose();
        setOpen({ characterId, anchorEl: el, source: 'click' });
      },
    }),
    [cancelClose],
  );

  // Hover anchor: F36 dispatcher pushes events here.
  const onHover = useCallback(
    (event: { characterId: string; anchorEl: HTMLElement } | null) => {
      if (event) {
        cancelClose();
        setOpen({ characterId: event.characterId, anchorEl: event.anchorEl, source: 'hover' });
        return;
      }
      // Hover-source leaves get the 150 ms grace; click-source ignores it.
      setOpen((prev) => {
        if (prev && prev.source === 'hover') {
          scheduleClose(ANCHOR_LEAVE_GRACE_MS);
        }
        return prev;
      });
    },
    [cancelClose, scheduleClose],
  );
  useCharRefHoverDispatcher(onHover);

  // Popover-leave grace: bind enter/leave to the rendered popover wrapper.
  useEffect(() => {
    if (!open) return;
    const popoverEl = document.querySelector<HTMLElement>('[data-character-popover-root]');
    if (!popoverEl) return;
    const handlePopoverEnter = (): void => cancelClose();
    const handlePopoverLeave = (): void => {
      if (open.source === 'hover') scheduleClose(POPOVER_LEAVE_GRACE_MS);
    };
    popoverEl.addEventListener('mouseenter', handlePopoverEnter);
    popoverEl.addEventListener('mouseleave', handlePopoverLeave);
    return () => {
      popoverEl.removeEventListener('mouseenter', handlePopoverEnter);
      popoverEl.removeEventListener('mouseleave', handlePopoverLeave);
    };
  }, [open, cancelClose, scheduleClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const character = useMemo(() => {
    if (!open || !characters) return null;
    return characters.find((c) => c.id === open.characterId) ?? null;
  }, [open, characters]);

  return (
    <div data-character-popover-root>
      <CharacterPopover
        character={character}
        anchorEl={open ? open.anchorEl : null}
        onClose={closeNow}
        onEdit={(id) => {
          closeNow();
          onEdit(id);
        }}
        consistencyEnabled={false}
      />
    </div>
  );
}
