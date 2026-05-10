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
