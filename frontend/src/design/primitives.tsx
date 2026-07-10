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
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  Ref,
  RefObject,
  TextareaHTMLAttributes,
} from 'react';
import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';

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
  /**
   * When false, escape and click-outside become no-ops. Default true.
   *
   * Nesting a Modal inside a Modal: the OUTER one must pass
   * `dismissable={false}` while the inner is open, or one Escape closes both.
   * Each Modal's Escape handler is its own `window` keydown listener, and
   * `stopPropagation()` does not stop sibling listeners on the same target —
   * flipping `dismissable` is what unregisters the outer listener.
   */
  dismissable?: boolean;
  /** Render only the card (no backdrop). Used by dashboard-embedded pickers. */
  embedded?: boolean;
  /** ARIA role for the card. "dialog" (default) for forms; "alertdialog" for confirmations. */
  role?: 'dialog' | 'alertdialog';
  /** Test ID for the card root. Backdrop defaults to `${testId}-backdrop`. */
  testId?: string;
  /** Override the backdrop's test ID (otherwise `${testId}-backdrop`). */
  backdropTestId?: string;
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
  role = 'dialog',
  testId,
  backdropTestId,
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
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is `dialog | alertdialog`; both support aria-modal.
    <div
      role={role}
      aria-modal={embedded ? undefined : 'true'}
      aria-labelledby={labelledBy}
      data-testid={testId}
      className={cx(
        SIZE_CLASS[size],
        'max-w-[94vw] max-h-[82vh] flex flex-col overflow-hidden',
        'rounded-[var(--radius-lg)] border border-line-2 bg-bg-elevated shadow-pop',
        embedded ? '' : 't-modal-in',
      )}
    >
      {children}
    </div>
  );

  if (embedded) return card;

  const computedBackdropTestId = backdropTestId ?? (testId ? `${testId}-backdrop` : undefined);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: presentation backdrop — keyboard close is handled by Esc, not focus on the backdrop
    <div
      role="presentation"
      data-testid={computedBackdropTestId}
      onMouseDown={handleBackdropMouseDown}
      className="t-backdrop-in fixed inset-0 z-50 bg-backdrop backdrop-blur-[3px] flex items-center justify-center"
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
  /** Disable the close button (e.g. while a destructive flow is mid-state). */
  closeDisabled?: boolean;
  /** Override the close button's test ID. Defaults to `modal-close`. */
  closeTestId?: string;
  /** Right-aligned slot, e.g. tabs or a secondary action. */
  trailing?: ReactNode;
}

export function ModalHeader({
  titleId,
  title,
  subtitle,
  onClose,
  closeDisabled,
  closeTestId,
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
          <IconButton
            onClick={onClose}
            disabled={closeDisabled}
            ariaLabel="Close"
            testId={closeTestId ?? 'modal-close'}
            size="lg"
          >
            <CloseIcon size="lg" />
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
  /**
   * Hit-target size. Default `'md'` = 28×28 (the historical IconButton size).
   * `'lg'` = 44×44, used by ModalHeader's close button to meet WCAG 2.5.5.
   */
  size?: 'md' | 'lg';
}

const ICON_BUTTON_SIZE: Record<NonNullable<IconButtonProps['size']>, string> = {
  md: 'w-7 h-7',
  lg: 'w-11 h-11',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { ariaLabel, active, testId, size = 'md', className, children, ...rest },
  ref,
): JSX.Element {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      aria-label={ariaLabel}
      data-testid={testId}
      data-size={size}
      className={cx(
        'grid place-items-center rounded-[var(--radius)] transition-colors',
        ICON_BUTTON_SIZE[size],
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

export interface CloseIconProps {
  /** `'md'` (default) = 14×14; `'lg'` = 20×20 to pair with `<IconButton size="lg">`. */
  size?: 'md' | 'lg';
}

export function CloseIcon({ size = 'md' }: CloseIconProps = {}): JSX.Element {
  const px = size === 'lg' ? 20 : 14;
  return (
    <svg
      width={px}
      height={px}
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

export function GripIcon(): JSX.Element {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3" r="1.2" />
      <circle cx="9" cy="3" r="1.2" />
      <circle cx="3" cy="7" r="1.2" />
      <circle cx="9" cy="7" r="1.2" />
      <circle cx="3" cy="11" r="1.2" />
      <circle cx="9" cy="11" r="1.2" />
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

/* ============================================================================
 * useInlineConfirm — controlled state for an inline Delete/Cancel pair.
 *
 * Owns the ephemeral concerns:
 *   - Open / close.
 *   - Escape dismisses.
 *   - Outside-click on the host element dismisses (capture-phase mousedown
 *     so a row-level handler doesn't swallow the event first).
 * ========================================================================== */

export interface UseInlineConfirmReturn {
  open: boolean;
  ask: () => void;
  dismiss: () => void;
  props: { onCancel: () => void };
}

export function useInlineConfirm(hostRef: RefObject<HTMLElement | null>): UseInlineConfirmReturn {
  const [open, setOpen] = useState(false);

  const ask = useCallback(() => {
    setOpen(true);
  }, []);
  const dismiss = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent): void => {
      const host = hostRef.current;
      if (!host) return;
      if (e.target instanceof Node && host.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [open, hostRef]);

  return { open, ask, dismiss, props: { onCancel: dismiss } };
}

/* ============================================================================
 * <InlineConfirm/> — destructive Delete/Cancel pair, autofocus on Delete.
 * ========================================================================== */

export interface InlineConfirmProps {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  testId?: string;
}

export function InlineConfirm({
  label,
  onConfirm,
  onCancel,
  pending,
  testId,
}: InlineConfirmProps): JSX.Element {
  const deleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    deleteRef.current?.focus();
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLFieldSetElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <fieldset
      aria-label={label}
      data-testid={testId}
      onKeyDown={onKeyDown}
      className="flex items-center gap-1.5 border-0 p-0 m-0"
    >
      <Button
        ref={deleteRef}
        variant="danger"
        size="sm"
        loading={pending}
        onClick={onConfirm}
        data-testid={testId ? `${testId}-delete` : undefined}
      >
        Delete
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={pending}
        data-testid={testId ? `${testId}-cancel` : undefined}
      >
        Cancel
      </Button>
    </fieldset>
  );
}

/* ============================================================================
 * <ConfirmDialog/> — modal Cancel/confirm dialog.
 *
 * The modal sibling of <InlineConfirm/>. Presentational: `pending` and
 * `error` are props, so the caller keeps its own mutation, error mapping,
 * and close-vs-stay-open policy.
 *
 * `dismissable` is deliberately NOT exposed. Escape/backdrop close via
 * `onCancel`. When this dialog is nested inside another Modal, the CALLER
 * must gate the outer modal with `dismissable={!open}` — that gate is what
 * makes layered Escape work (it tears down the outer window listener, so
 * only one is ever registered). `stopPropagation` does not do this.
 * ========================================================================== */

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  /** Action-button label, e.g. "Delete" | "Confirm" | "Regenerate". */
  confirmLabel: string;
  /** Action-button variant. Default "danger". */
  confirmVariant?: 'danger' | 'primary';
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Disables Cancel; puts a spinner on the action button. */
  pending?: boolean;
  /** Rendered role="alert" under the body. The dialog stays open. */
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  /** Root id. Buttons/error derive `${testId}-confirm|-cancel|-error`. */
  testId?: string;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  confirmVariant = 'danger',
  cancelLabel = 'Cancel',
  pending,
  error,
  onConfirm,
  onCancel,
  testId,
}: ConfirmDialogProps): JSX.Element {
  const titleId = useId();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      labelledBy={titleId}
      size="sm"
      role="alertdialog"
      testId={testId}
    >
      <ModalHeader titleId={titleId} title={title} />
      <ModalBody>
        <p className="font-serif text-[13.5px] leading-[1.55] text-ink-2">{body}</p>
        {error ? (
          <p
            role="alert"
            className="mt-3 font-sans text-[12.5px] text-danger"
            data-testid={testId ? `${testId}-error` : undefined}
          >
            {error}
          </p>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={pending}
          data-testid={testId ? `${testId}-cancel` : undefined}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={confirmVariant}
          loading={pending}
          onClick={onConfirm}
          data-testid={testId ? `${testId}-confirm` : undefined}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/* ============================================================================
 * revealOnRowHover — shared class fragment for row-level action clusters:
 * invisible until the row (a `group` container) is hovered or focus moves
 * inside. One source of truth so ChapterList / DraftList reveals can't drift.
 * ========================================================================== */

export const revealOnRowHover =
  'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100';

/* ============================================================================
 * <InlineEdit/> — row content swaps for a text input (sibling interaction to
 * InlineConfirm). Enter/blur commit the TRIMMED value (empty string is a
 * valid commit — the caller owns "cleared" semantics); Escape cancels and
 * suppresses the blur-commit that follows.
 * ========================================================================== */

export interface InlineEditProps {
  initialValue: string;
  placeholder?: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  testId?: string;
}

export function InlineEdit({
  initialValue,
  placeholder,
  ariaLabel,
  onCommit,
  onCancel,
  testId,
}: InlineEditProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape → cancel must also swallow the blur that refocusing/unmounting
  // fires right after; committing must be once-only (Enter then unmount-blur).
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = (): void => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCommit(value.trim());
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      settledRef.current = true;
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-testid={testId}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={commit}
      className="flex-1 min-w-0 h-6 px-1.5 font-sans text-[12.5px] text-ink bg-bg-elevated border border-line-2 rounded-[var(--radius)] outline-none focus:border-ink-3"
    />
  );
}

/* ============================================================================
 * FieldRow — labelled definition-list row with em-dash fallback for blank values
 * ========================================================================== */

export interface FieldRowProps {
  label: string;
  value: string | null;
}

export function FieldRow({ label, value }: FieldRowProps): JSX.Element {
  const display = value && value.trim().length > 0 ? value : '—';
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[.08em] text-ink-4 font-mono mt-2">{label}</dt>
      <dd className="font-serif text-[13px] text-ink mt-0.5 whitespace-pre-wrap">{display}</dd>
    </div>
  );
}

/* Re-export useId so consumers don't need a second React import. */
export { useId, useRef };
