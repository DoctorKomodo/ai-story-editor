/* =============================================================================
 * Inkwell Design Primitives
 * -----------------------------------------------------------------------------
 * Headless-ish, token-aware building blocks that every modal/form/list
 * component should compose from. Extracted from the patterns already proven
 * in `StoryPicker`, `ModelPicker`, `AuthForm`, and `ChatComposer`.
 *
 * What's here:
 *   <Modal>          — backdrop + card + escape + focus management
 *   <ModalHeader>    — title + subtitle + close button row
 *   <ModalFooter>    — left meta + right action group
 *   <Button>         — primary | ghost | danger | link
 *   <IconButton>     — square 28×28 hover surface for SVG glyphs
 *   <Field>          — label + hint + input/textarea wrapper
 *   <Input>          — text input styled with mono / serif option
 *   <Textarea>       — same, multi-line
 *   <Pill>           — small uppercase status chip ("open", "draft", etc)
 *   <Spinner>        — 12px spinner for inline loading states
 *
 * To use in the live app:
 *   1. Drop this file at `frontend/src/design/primitives.tsx`.
 *   2. `import { Modal, Button, Field } from '@/design/primitives'` from any
 *      component being migrated.
 *   3. See `MIGRATION.md` § "Porting a component" for a worked example
 *      (CharacterSheet → primitives).
 *
 * Conventions:
 *   - Every interactive element accepts `data-testid` for Playwright.
 *   - No raw color literals — only token classes/vars.
 *   - No `useState` for ephemeral UI here; primitives are controlled.
 *   - Sizes default to the Inkwell density: 13px body, 12px captions, 11px
 *     metadata. Override via the `size` prop where offered.
 * =========================================================================== */

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  JSX,
  MouseEvent,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from 'react';
import { forwardRef, useEffect, useId, useRef } from 'react';

/* ---------- helpers --------------------------------------------------------- */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ============================================================================
 * Modal
 * Backdrop + centered card. Handles escape, click-outside, initial focus.
 * Use for ANY dialog: confirmations, full forms, pickers.
 * ========================================================================== */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name — id of the heading element. Use `useId()` upstream. */
  labelledBy: string;
  /** "sm" 360 · "md" 480 (default) · "lg" 640 · "xl" 800 */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** When false, escape and click-outside become no-ops. Default true. */
  dismissable?: boolean;
  /** Render only the card (no backdrop). Used by dashboard-embedded pickers. */
  embedded?: boolean;
  /** Test ID for the card root. Backdrop gets `${testId}-backdrop`. */
  testId?: string;
  children: ReactNode;
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'w-[360px]',
  md: 'w-[480px]',
  lg: 'w-[640px]',
  xl: 'w-[800px]',
};

export function Modal({
  open,
  onClose,
  labelledBy,
  size = 'md',
  dismissable = true,
  embedded = false,
  testId,
  children,
}: ModalProps): JSX.Element | null {
  // Escape closes (priority 100 — same as StoryPicker convention).
  useEffect(() => {
    if (!open || !dismissable || embedded) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, dismissable, embedded, onClose]);

  if (!open) return null;

  const handleBackdropMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    if (!dismissable) return;
    if (e.target === e.currentTarget) onClose();
  };

  const card = (
    <div
      role="dialog"
      aria-modal={embedded ? undefined : 'true'}
      aria-labelledby={labelledBy}
      data-testid={testId}
      className={cx(
        SIZE_CLASS[size],
        'max-w-[94vw] max-h-[82vh] flex flex-col overflow-hidden',
        'rounded-[var(--radius-lg)] border border-line-2 bg-bg-elevated shadow-pop',
        embedded ? '' : 't-modal-in fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
      )}
    >
      {children}
    </div>
  );

  if (embedded) return card;

  return (
    <div
      role="presentation"
      data-testid={testId ? `${testId}-backdrop` : undefined}
      onMouseDown={handleBackdropMouseDown}
      className="t-backdrop-in fixed inset-0 z-50 bg-[rgba(20,18,12,.4)] backdrop-blur-[3px] flex items-center justify-center"
    >
      {card}
    </div>
  );
}

/* ============================================================================
 * ModalHeader / ModalFooter
 * Standard chrome rows. Use them so every dialog has identical padding,
 * border, and typography.
 * ========================================================================== */

export interface ModalHeaderProps {
  titleId: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Render the X close button. Pass undefined to hide. */
  onClose?: () => void;
  /** Right-aligned slot, e.g. tabs or a secondary action. */
  trailing?: ReactNode;
}

export function ModalHeader({
  titleId,
  title,
  subtitle,
  onClose,
  trailing,
}: ModalHeaderProps): JSX.Element {
  return (
    <header className="px-[18px] py-[14px] border-b border-line flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h2
          id={titleId}
          className="m-0 font-serif text-[18px] font-medium text-ink tracking-[-0.005em] truncate"
        >
          {title}
        </h2>
        {subtitle ? (
          <div className="mt-[2px] text-[12px] text-ink-4 font-sans">{subtitle}</div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {trailing}
        {onClose ? (
          <IconButton onClick={onClose} ariaLabel="Close" testId="modal-close">
            <CloseIcon />
          </IconButton>
        ) : null}
      </div>
    </header>
  );
}

export interface ModalFooterProps {
  /** Left-aligned, usually metadata text ("12 stories in vault"). */
  leading?: ReactNode;
  /** Right-aligned action buttons. */
  children?: ReactNode;
}

export function ModalFooter({ leading, children }: ModalFooterProps): JSX.Element {
  return (
    <footer className="px-[18px] py-3 border-t border-line flex items-center justify-between gap-3">
      <span className="font-mono text-[12px] text-ink-4 truncate">{leading}</span>
      <div className="flex gap-2 flex-shrink-0">{children}</div>
    </footer>
  );
}

/* ============================================================================
 * ModalBody — scroll region between header and footer
 * ========================================================================== */

export function ModalBody({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className={cx('flex-1 overflow-y-auto p-3', className)} {...rest}>
      {children}
    </div>
  );
}

/* ============================================================================
 * Button
 * Four variants — primary (ink fill), ghost (line border), danger, link.
 * Two sizes — sm (28px) and md (default 32px).
 * ========================================================================== */

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render leading spinner + disable. */
  loading?: boolean;
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius)] ' +
  'font-sans font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-bg hover:bg-ink-2',
  ghost:
    'bg-transparent text-ink-2 border border-line hover:bg-[var(--surface-hover)] hover:text-ink',
  danger: 'bg-[var(--danger)] text-bg hover:opacity-90',
  link: 'bg-transparent text-ink-3 underline underline-offset-2 hover:text-ink px-0 py-0',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px]',
  md: 'h-8 px-3 text-[12.5px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', loading, disabled, className, children, ...rest },
  ref,
): JSX.Element {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled ?? loading}
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANT[variant],
        variant === 'link' ? '' : BUTTON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

/* ============================================================================
 * IconButton — 28×28 with SVG child
 * ========================================================================== */

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ariaLabel: string;
  active?: boolean;
  testId?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { ariaLabel, active, testId, className, children, ...rest },
  ref,
): JSX.Element {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cx(
        'grid place-items-center w-7 h-7 rounded-[var(--radius)] transition-colors',
        active
          ? 'bg-[var(--accent-soft)] text-ink'
          : 'text-ink-3 hover:bg-[var(--surface-hover)] hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ============================================================================
 * Field — label + hint + child input
 * Mirrors AuthForm's Field; promoted to a primitive so every form looks
 * the same.
 * ========================================================================== */

export interface FieldProps {
  label: ReactNode;
  /** Right-aligned helper text in the label row, e.g. "Required" or "Optional". */
  hint?: ReactNode;
  /** Below-the-input error text. Sets `aria-invalid` on inner inputs via context-less prop drilling — pass `invalid` directly to <Input>. */
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, htmlFor, children }: FieldProps): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="flex justify-between items-baseline gap-2 text-[12px] font-medium font-sans text-ink-2">
        <span>{label}</span>
        {hint ? <span className="text-[11px] font-normal text-ink-4">{hint}</span> : null}
      </span>
      {children}
      {error ? (
        <span role="alert" className="text-[11.5px] text-[color:var(--danger)] font-sans">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/* ============================================================================
 * Input / Textarea
 * Mono is the default per Camp A convention (AuthForm, SettingsWritingTab).
 * Pass `font="serif"` for prose fields, `font="sans"` for chrome.
 * ========================================================================== */

type InputFont = 'mono' | 'serif' | 'sans';

const INPUT_BASE =
  'w-full px-2.5 py-2 text-[13.5px] bg-bg-elevated ' +
  'border border-line-2 rounded-[var(--radius)] text-ink ' +
  'placeholder:text-ink-4 ' +
  'focus:outline-none focus:border-ink-3 transition-colors ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const FONT_CLASS: Record<InputFont, string> = {
  mono: 'font-mono',
  serif: 'font-serif',
  sans: 'font-sans',
};

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  font?: InputFont;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { font = 'mono', invalid, className, ...rest },
  ref,
): JSX.Element {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(
        INPUT_BASE,
        FONT_CLASS[font],
        invalid ? 'border-[color:var(--danger)] focus:border-[color:var(--danger)]' : '',
        className,
      )}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  font?: InputFont;
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { font = 'serif', invalid, rows = 3, className, ...rest },
  ref,
): JSX.Element {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cx(
        INPUT_BASE,
        FONT_CLASS[font],
        'resize-y leading-[1.55]',
        invalid ? 'border-[color:var(--danger)] focus:border-[color:var(--danger)]' : '',
        className,
      )}
      {...rest}
    />
  );
});

/* ============================================================================
 * Pill — small uppercase status chip
 * ========================================================================== */

export type PillTone = 'accent' | 'ai' | 'danger' | 'neutral';

const PILL_TONE: Record<PillTone, string> = {
  accent: 'bg-[var(--accent-soft)] text-ink',
  ai: 'bg-[var(--ai-soft)] text-[color:var(--ai)]',
  danger: 'bg-[color:var(--danger)] text-bg',
  neutral: 'bg-[var(--bg-sunken)] text-ink-3',
};

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
}

export function Pill({ tone = 'accent', className, children, ...rest }: PillProps): JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center px-2 py-0.5 rounded-full',
        'text-[10px] uppercase tracking-[.08em] font-sans',
        PILL_TONE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/* ============================================================================
 * Spinner — 12px circular
 * ========================================================================== */

export function Spinner({ size = 12 }: { size?: number }): JSX.Element {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{ width: size, height: size }}
      className="inline-block rounded-full border-[1.5px] border-current border-t-transparent animate-spin opacity-70"
    />
  );
}

/* ============================================================================
 * CloseIcon — used by ModalHeader's auto-close button
 * ========================================================================== */

function CloseIcon(): JSX.Element {
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
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

/* ============================================================================
 * useAutofocus — focus a ref after open. Call from any modal that wants
 * the first input to receive focus.
 *
 *   const inputRef = useRef<HTMLInputElement>(null);
 *   useAutofocus(inputRef, open);
 * ========================================================================== */

export function useAutofocus<T extends HTMLElement>(ref: Ref<T>, when: boolean): void {
  useEffect(() => {
    if (!when) return;
    const id = window.setTimeout(() => {
      const node = (ref as { current: T | null }).current;
      node?.focus();
    }, 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [ref, when]);
}

/* Re-export useId so consumers don't need a second React import. */
export { useId, useRef };
