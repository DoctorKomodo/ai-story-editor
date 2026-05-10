# Shared Copy-to-Clipboard Hook (story-editor-3y0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the silent-failure copy button on Chat / Scene assistant messages, support self-hosted LAN deployments where `navigator.clipboard` is unavailable (insecure context), and consolidate three duplicate clipboard call sites onto one hook with a "Copied!" / "Couldn't copy" status flash.

**Architecture:** New `useCopyToClipboard` hook owns the copy strategy (try `navigator.clipboard.writeText` → fall back to hidden-textarea + `document.execCommand('copy')` → return `'failed'` status if both fail) and the auto-reset state machine. The `CopyAction` primitive grows an optional `status` prop and renders a brief inline label when status is `'copied'` or `'failed'`. ChatTab, SceneTab, and RecoveryCodeCard migrate onto the hook; RecoveryCodeCard's inline state machine is deleted.

**Tech Stack:** React 19, TypeScript, Vitest + jsdom, Storybook.

---

## Why a fallback rather than an error-only path

Self-hosted Inkwell over a LAN (e.g. `http://192.168.0.41:3000`) is not a secure context: `navigator.clipboard` is `undefined` and the current `navigator.clipboard?.writeText(text)` silently no-ops. The legacy `document.execCommand('copy')` path still works in Chromium / Firefox / Safari as of 2026 (deprecated but supported) and is the right fallback for users who haven't put a reverse proxy + HTTPS in front of the app. When even the fallback fails (locked-down browsers, no document focus), the hook surfaces a `'failed'` status so the consumer can show a recoverable message.

## File structure

**Create:**
- `frontend/src/hooks/useCopyToClipboard.ts` — the hook (Clipboard API → execCommand fallback → status machine).
- `frontend/tests/hooks/useCopyToClipboard.test.ts` — hook tests (success / unavailable / clipboard reject / execCommand fallback success / execCommand fallback fail).
- `frontend/src/components/messageRow/primitives.copyaction.stories.tsx` — Storybook story for CopyAction's three visual states (idle / copied / failed). *(If a primitives Storybook file already covers CopyAction, extend it instead of creating a new file — Task 2 will check.)*

**Modify:**
- `frontend/src/components/messageRow/primitives.tsx` — `CopyAction` accepts optional `status?: 'idle' | 'copied' | 'failed'` and renders a brief text label next to the icon when `status !== 'idle'`. Also expose existing `disabled` semantics.
- `frontend/src/components/ChatTab.tsx` — replace `onCopy` body with the hook; pass `status` to `CopyAction`.
- `frontend/src/components/SceneTab.tsx` — same as ChatTab.
- `frontend/src/components/RecoveryCodeCard.tsx` — delete the inline `copied` / `copyFailed` state, use the hook. Keep the existing failure paragraph copy (the wording is good); drive its visibility from the hook's `status === 'failed'`.

**Test (modify):**
- `frontend/tests/components/RecoveryCodeCard.test.tsx` — existing tests must still pass; mock the hook (or `navigator.clipboard` + `document.execCommand`) to drive the same observable transitions.

---

## File-size & convention notes

- The hook file is small (~60 lines including types). Don't grow it with features unrelated to clipboard (e.g. global toast plumbing — consumers can wire `useErrorStore` themselves if they want a toast in addition to the inline indicator).
- Per `frontend/scripts/lint-design.mjs`: any new component classes must use theme tokens (`--ink-*`, `--bg-*`, etc.). The status text in CopyAction goes via existing token classes (e.g. `text-ink-2`, `text-ink-3`); no raw hex.
- Follow the existing `RecoveryCodeCard.tsx:84-86` pattern for accessibility on the copied-state announcement (`aria-live="polite" aria-atomic="true"`).

---

### Task 1: write the `useCopyToClipboard` hook (TDD)

**Files:**
- Create: `frontend/src/hooks/useCopyToClipboard.ts`
- Create: `frontend/tests/hooks/useCopyToClipboard.test.ts`

The hook owns three responsibilities:
1. Feature-detect `navigator.clipboard?.writeText`.
2. On `copy(text)`: try the modern API, on rejection or undefined call `executeFallbackCopy(text)` (a hidden textarea + `document.execCommand('copy')`); set status to `'copied'` on either path's success and `'failed'` if both fail.
3. Auto-reset status back to `'idle'` after `resetMs` (default 2000) using a `setTimeout` cleared on unmount + on re-invocation.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/tests/hooks/useCopyToClipboard.test.ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

describe('useCopyToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;
  const originalIsSecureContext = window.isSecureContext;

  function setSecureContext(value: boolean): void {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom defaults window.isSecureContext to false; tests that exercise
    // the modern path must opt in explicitly.
    setSecureContext(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    document.execCommand = originalExecCommand;
    setSecureContext(originalIsSecureContext);
  });

  it('starts in idle status', () => {
    const { result } = renderHook(() => useCopyToClipboard());
    expect(result.current.status).toBe('idle');
  });

  it('clipboard API success → status becomes "copied" then auto-resets to "idle"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const { result } = renderHook(() => useCopyToClipboard({ resetMs: 1500 }));
    await act(async () => {
      await result.current.copy('hello');
    });

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result.current.status).toBe('copied');

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
  });

  it('clipboard API undefined → falls back to execCommand, status becomes "copied"', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec as unknown as typeof document.execCommand;

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('lan-text');
    });

    expect(exec).toHaveBeenCalledWith('copy');
    expect(result.current.status).toBe('copied');
  });

  it('non-secure context → skips clipboard API entirely and falls back', async () => {
    setSecureContext(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec as unknown as typeof document.execCommand;

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('lan-ip-text');
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(result.current.status).toBe('copied');
  });

  it('clipboard API rejects → falls back to execCommand', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('not focused'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec as unknown as typeof document.execCommand;

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('text');
    });

    expect(writeText).toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith('copy');
    expect(result.current.status).toBe('copied');
  });

  it('both paths fail → status becomes "failed"', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const exec = vi.fn().mockReturnValue(false);
    document.execCommand = exec as unknown as typeof document.execCommand;

    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('text');
    });

    expect(result.current.status).toBe('failed');
  });

  it('a second copy() resets the timer (no premature flip back to idle)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const { result } = renderHook(() => useCopyToClipboard({ resetMs: 1500 }));
    await act(async () => {
      await result.current.copy('a');
    });
    expect(result.current.status).toBe('copied');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      await result.current.copy('b');
    });
    // 1000ms more — total 2000ms since first copy, but only 1000ms since second
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.status).toBe('copied');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend test -- useCopyToClipboard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// frontend/src/hooks/useCopyToClipboard.ts
import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyStatus = 'idle' | 'copied' | 'failed';

export interface UseCopyToClipboardOptions {
  /** ms before status auto-resets to 'idle'. Default 2000. */
  resetMs?: number;
}

export interface UseCopyToClipboardResult {
  status: CopyStatus;
  copy: (text: string) => Promise<void>;
}

function executeFallbackCopy(text: string): boolean {
  // Legacy execCommand path for non-secure contexts (LAN-IP self-hosting,
  // file://, etc.) where navigator.clipboard is undefined. Deprecated but
  // still supported across major browsers as of 2026.
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  // iOS Safari (and some Firefox versions) require focus before select for
  // document.execCommand('copy') to succeed. The fallback path exists for
  // non-secure-context users (LAN self-host), many of whom are on mobile —
  // skipping focus() silently fails exactly where the fallback needs to work.
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return ok;
}

export function useCopyToClipboard(opts?: UseCopyToClipboardOptions): UseCopyToClipboardResult {
  const resetMs = opts?.resetMs ?? 2000;
  const [status, setStatus] = useState<CopyStatus>('idle');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copy = useCallback(
    async (text: string): Promise<void> => {
      let ok = false;
      // Pair the navigator.clipboard?.writeText feature-detect with
      // window.isSecureContext: some historical Chromium builds exposed
      // navigator.clipboard over plain HTTP but rejected writeText at call
      // time. Checking isSecureContext skips the rejection round-trip.
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        ok = executeFallbackCopy(text);
      }
      setStatus(ok ? 'copied' : 'failed');
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        setStatus('idle');
        timerRef.current = null;
      }, resetMs);
    },
    [resetMs],
  );

  return { status, copy };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix frontend test -- useCopyToClipboard`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useCopyToClipboard.ts frontend/tests/hooks/useCopyToClipboard.test.ts
git commit -m "[3y0] add useCopyToClipboard hook with execCommand fallback"
```

---

### Task 2: extend `CopyAction` primitive with a status prop

**Files:**
- Modify: `frontend/src/components/messageRow/primitives.tsx:74-113` (CopyAction definition)
- Test: `frontend/tests/components/messageRow/primitives.test.tsx` *(extend if already exists; otherwise the existing primitives.stories.tsx covers visual coverage)*

CopyAction grows `status?: 'idle' | 'copied' | 'failed'`. When status is `'copied'` it renders the icon + "Copied" text; when `'failed'` it renders the icon + "Couldn't copy" text. Both states use existing token classes (`text-ink-2` or `text-ink-3`) and add `aria-live="polite" aria-atomic="true"` on the status text span so screen readers announce transitions.

- [ ] **Step 1: Modify the primitive**

Replace `frontend/src/components/messageRow/primitives.tsx:76-113` with:

```tsx
export interface CopyActionProps {
  onClick: () => void;
  disabled?: boolean;
  status?: 'idle' | 'copied' | 'failed';
}

function CopyIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CopyAction({ onClick, disabled, status = 'idle' }: CopyActionProps): JSX.Element {
  const label =
    status === 'copied' ? 'Copied' : status === 'failed' ? "Couldn't copy" : null;
  return (
    <button
      type="button"
      className="px-2 py-1 rounded-[var(--radius)] text-ink-2 hover:bg-surface-hover inline-flex items-center gap-1 transition-colors disabled:opacity-60"
      aria-label="Copy"
      title="Copy"
      onClick={onClick}
      disabled={disabled}
    >
      <CopyIcon />
      {label !== null ? (
        <span aria-live="polite" aria-atomic="true" className="text-[12px]">
          {label}
        </span>
      ) : null}
    </button>
  );
}
```

- [ ] **Step 2: Update or add the Storybook story for the three states**

Open `frontend/src/components/messageRow/primitives.stories.tsx` and add a story that renders three CopyAction instances side-by-side: `status="idle"`, `status="copied"`, `status="failed"`. Each in its own meta block with title "Primitives/MessageRow/CopyAction — Status states".

If the existing primitives.stories.tsx already structures stories per-component, append the new story under the existing CopyAction section. Otherwise create the file `frontend/src/components/messageRow/primitives.copyaction.stories.tsx` with a single default export and three named exports: `Idle`, `Copied`, `Failed`.

- [ ] **Step 3: Verify the story renders**

Run: `npm --prefix frontend run storybook`, navigate to the new story in the sidebar, confirm each state renders as expected (icon only / icon+"Copied" / icon+"Couldn't copy"). *(Manual verify — no test added at this step; the wired component tests in Task 6 cover behaviour.)*

- [ ] **Step 4: Run frontend typecheck and tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test`
Expected: typecheck clean; existing primitives tests still pass (no regressions from the new optional prop).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/messageRow/primitives.tsx frontend/src/components/messageRow/*.stories.tsx
git commit -m "[3y0] CopyAction: add status prop ('idle' | 'copied' | 'failed')"
```

---

### Task 3: migrate ChatTab onto the hook

**Files:**
- Modify: `frontend/src/components/ChatTab.tsx:164-170` (onCopy handler) and the `<CopyAction>` site at `:234`.
- Test: extend `frontend/tests/components/ChatTab.test.tsx` if it exists; otherwise leave coverage to the manual + Task 6 component test.

- [ ] **Step 1: Replace the inline copy handler**

In `frontend/src/components/ChatTab.tsx`:

1. Add the import near the other hook imports:
   ```ts
   import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
   ```
2. Inside the component body (near the other `useCallback`s), replace the existing `onCopy` block with:
   ```ts
   const { copy: copyToClipboard, status: copyStatus } = useCopyToClipboard();

   const onCopy = useCallback(
     (message: ChatMessage) => {
       const text =
         typeof message.contentJson === 'string'
           ? message.contentJson
           : JSON.stringify(message.contentJson);
       void copyToClipboard(text);
     },
     [copyToClipboard],
   );
   ```
3. Update the `<CopyAction onClick={() => onCopy(r.message)} />` site at `:234` to pass `status={copyStatus}`:
   ```tsx
   <CopyAction onClick={() => onCopy(r.message)} status={copyStatus} />
   ```

- [ ] **Step 2: Run frontend typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ChatTab.tsx
git commit -m "[3y0] ChatTab: copy via useCopyToClipboard, surface status"
```

---

### Task 4: migrate SceneTab onto the hook

**Files:**
- Modify: `frontend/src/components/SceneTab.tsx` (onCopy handler around `:164-170` and `<CopyAction>` site around `:258`).

- [ ] **Step 1: Apply the same change as Task 3 to SceneTab**

Imports + hook usage + `<CopyAction status={copyStatus} />` mirror the ChatTab edit. The `onCopy` body is identical.

- [ ] **Step 2: Run frontend typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SceneTab.tsx
git commit -m "[3y0] SceneTab: copy via useCopyToClipboard, surface status"
```

---

### Task 5: migrate `RecoveryCodeCard` onto the hook

**Files:**
- Modify: `frontend/src/components/RecoveryCodeCard.tsx:39-58` (delete inline state machine; use the hook).

The inline `copied` / `copyFailed` `useState`s and the `COPIED_FLASH_MS` constant go away. The button label and the failure paragraph drive their text/visibility from `status`.

- [ ] **Step 1: Replace the inline state with the hook**

```tsx
// near the imports
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

// inside the component, replace:
//   const [copied, setCopied] = useState(false);
//   const [copyFailed, setCopyFailed] = useState(false);
//   const copy = async (): Promise<void> => { ... }
// with:
const { status: copyStatus, copy: copyToClipboard } = useCopyToClipboard({ resetMs: 2000 });
```

Update the button onClick (use the inline-arrow style already established in this file), the label, and the failure paragraph:

```tsx
<button
  type="button"
  onClick={() => {
    void copyToClipboard(recoveryCode);
  }}
  className="…unchanged…"
>
  <span aria-live="polite" aria-atomic="true">
    {copyStatus === 'copied' ? 'Copied' : 'Copy'}
  </span>
</button>

{copyStatus === 'failed' ? (
  <p role="status" className="text-[12px] text-[var(--ink-3)] m-0">
    Copy isn’t available in this browser. Use Download, or select the code above and copy it
    manually.
  </p>
) : null}
```

Drop the now-unused `useState` import line if no other state survives in the file.

- [ ] **Step 2: Update RecoveryCodeCard tests if needed**

Run: `npm --prefix frontend test -- RecoveryCodeCard`
- If tests pass: skip to Step 3.
- If tests rely on the inline state setters (e.g. they spy on a private function): rewrite the test to drive observable behaviour via `navigator.clipboard` mocks (the same pattern Task 1 uses). The user-facing assertions (button text changes to "Copied", failure paragraph appears when clipboard is unavailable) should not change.

- [ ] **Step 3: Run frontend typecheck + tests**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/RecoveryCodeCard.tsx frontend/tests/components/RecoveryCodeCard.test.tsx
git commit -m "[3y0] RecoveryCodeCard: migrate onto useCopyToClipboard"
```

---

### Task 6: integration test — Chat copy state transitions

**Files:**
- Create: `frontend/tests/components/ChatTab.copy.test.tsx` (new file, tightly scoped to the copy-button transition).

The hook itself is unit-tested in Task 1; this test asserts the wired-up Chat path: clicking the copy icon under an assistant message calls `navigator.clipboard.writeText` (or the fallback) and the icon's accessible name flips through `'Copied'` → `'idle'`.

If creating an isolated ChatTab test requires extensive harness setup (router, query client, store fixtures), reuse whatever fixture pattern existing ChatTab tests already use. If no ChatTab test exists yet, scope the new test minimally — render a tiny harness that mounts a single `<CopyAction onClick={…} status={…} />` driven by `useCopyToClipboard`, and assert the transitions there. SceneTab does not need its own test — the surface is identical.

- [ ] **Step 1: Inspect existing ChatTab tests to choose harness pattern**

Run: `ls frontend/tests/components/ChatTab*.test.* 2>/dev/null && grep -l "ChatTab" frontend/tests/components/*.test.*`

If a ChatTab test exists: extend it with the new copy-state describe.
If not: write the minimal driver test described below, against `<CopyAction>` + `useCopyToClipboard` directly, scoped to assert the wiring contract (status transitions reach the visible label).

- [ ] **Step 2: Write the test**

```tsx
// frontend/tests/components/ChatTab.copy.test.tsx (or extension to existing file)
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CopyAction } from '@/components/messageRow/primitives';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

function CopyHarness({ text }: { text: string }): JSX.Element {
  const { copy, status } = useCopyToClipboard({ resetMs: 1000 });
  return <CopyAction onClick={() => void copy(text)} status={status} />;
}

describe('CopyAction wired with useCopyToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const originalIsSecureContext = window.isSecureContext;

  function setSecureContext(value: boolean): void {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    setSecureContext(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    setSecureContext(originalIsSecureContext);
  });

  it('clicking the icon writes via Clipboard API and shows "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CopyHarness text="ASSISTANT_REPLY" />);

    await user.click(screen.getByLabelText('Copy'));

    expect(writeText).toHaveBeenCalledWith('ASSISTANT_REPLY');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('Clipboard API undefined → falls back to execCommand and still shows "Copied"', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec as unknown as typeof document.execCommand;

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CopyHarness text="LAN_REPLY" />);

    await user.click(screen.getByLabelText('Copy'));

    expect(exec).toHaveBeenCalledWith('copy');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the new tests**

Run: `npm --prefix frontend test -- ChatTab.copy`
Expected: PASS — both transitions covered.

- [ ] **Step 4: Run full frontend suite**

Run: `npm --prefix frontend test`
Expected: full suite green (no regressions).

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/components/ChatTab.copy.test.tsx
git commit -m "[3y0] tests: CopyAction + useCopyToClipboard wired transitions"
```

---

## Manual verification (after all automated tasks pass)

Run the dev stack and confirm — this is the "(manual)" half of the bd issue's verify line:

```bash
make dev
```

1. Open `http://localhost:3000`. Send a chat message (Chat tab). Click the copy icon under the assistant reply. Paste somewhere; confirm the text appears. Confirm the icon briefly shows "Copied" next to it before reverting.
2. Open `http://<lan-ip>:3000` from another device on the LAN (this is the path that was previously broken). Repeat the click + paste. Confirm execCommand fallback path works and the "Copied" label flashes.
3. Repeat in Scene tab.
4. (Optional) Lock down the browser to deny clipboard + execCommand (e.g. iframe sandbox); confirm "Couldn't copy" appears.

Document in PR body whether step 2 was tested with a real LAN device or only verified via DevTools forcing `navigator.clipboard = undefined`.

---

## Self-review checklist (before opening PR)

- [ ] All three call sites (ChatTab, SceneTab, RecoveryCodeCard) use the hook; no `navigator.clipboard?.writeText` calls remain in `frontend/src` outside the hook.
- [ ] CopyAction's `status` prop is optional (existing call sites that don't pass it still compile).
- [ ] Token-only styling — `lint:design` passes.
- [ ] Hook auto-resets `'failed'` to `'idle'` on the same timer (the test in Task 1 only covers `'copied'` → `'idle'`; verify by inspection that the same `setTimeout` runs for failed).
- [ ] No new dependencies added.
