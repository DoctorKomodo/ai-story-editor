// [F31] Editor format bar — 40px tall, 6px/24px padding, grouped icon
// buttons matching `mockups/frontend-prototype/design/editor.jsx`.
//
// F31 ships the component only; F32 refactors `Editor.tsx` to use it.
// Until then the existing F8 toolbar in Editor.tsx is left untouched and
// FormatBar is exercised by tests via a small harness that mounts a real
// TipTap editor with `formatBarExtensions`.
//
// Buttons are 28×28 and reuse the shared `.icon-btn` class added in F26.
// `aria-pressed` reflects the live editor mark/node state. When `editor`
// is null (initial mount) every action button is disabled but the toolbar
// still renders so layout doesn't shift.
import type { Editor as TiptapEditor } from '@tiptap/core';
import { type JSX, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useFocusToggle } from '@/hooks/useFocusToggle';

export interface FormatBarProps {
  editor: TiptapEditor | null;
  onToggleFind?: () => void;
}

type StyleOption =
  | { id: 'paragraph'; label: 'Body' }
  | { id: 'h1'; label: 'Heading 1' }
  | { id: 'h2'; label: 'Heading 2' }
  | { id: 'h3'; label: 'Heading 3' }
  | { id: 'quote'; label: 'Quote' };

const STYLE_OPTIONS: readonly StyleOption[] = [
  { id: 'paragraph', label: 'Body' },
  { id: 'h1', label: 'Heading 1' },
  { id: 'h2', label: 'Heading 2' },
  { id: 'h3', label: 'Heading 3' },
  { id: 'quote', label: 'Quote' },
] as const;

function currentStyleLabel(editor: TiptapEditor | null): string {
  if (!editor) return 'Body';
  if (editor.isActive('heading', { level: 1 })) return 'Heading 1';
  if (editor.isActive('heading', { level: 2 })) return 'Heading 2';
  if (editor.isActive('heading', { level: 3 })) return 'Heading 3';
  if (editor.isActive('blockquote')) return 'Quote';
  return 'Body';
}

function applyStyle(editor: TiptapEditor, id: StyleOption['id']): void {
  const chain = editor.chain().focus();
  switch (id) {
    case 'paragraph':
      chain.setParagraph().run();
      return;
    case 'h1':
      chain.setHeading({ level: 1 }).run();
      return;
    case 'h2':
      chain.setHeading({ level: 2 }).run();
      return;
    case 'h3':
      chain.setHeading({ level: 3 }).run();
      return;
    case 'quote':
      // `setBlockquote` doesn't exist; toggle is the documented path.
      if (!editor.isActive('blockquote')) {
        chain.toggleBlockquote().run();
      }
      return;
  }
}

interface FbButtonProps {
  label: string;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}

function FbButton({
  label,
  onClick,
  isActive,
  disabled,
  title,
  children,
}: FbButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isActive ?? false}
      disabled={disabled ?? false}
      title={title}
      onClick={onClick}
      // Keep clicks from collapsing the editor selection — the standard
      // TipTap toolbar pattern. Same trick as the selection bubble in F34.
      onMouseDown={(e) => e.preventDefault()}
      className={`fb-btn icon-btn${isActive ? ' active' : ''}`}
    >
      {children}
    </button>
  );
}

// --- Inline icons --------------------------------------------------------
// Small inline SVGs keep us off another dependency. 14×14 mirrors the
// mockup's `<Icons.* size={14}/>` calls. `currentColor` lets `.icon-btn`
// drive colour from the design tokens.
const iconProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function IconUndo(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  );
}
function IconRedo(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
    </svg>
  );
}
function IconBold(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z" />
      <path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z" />
    </svg>
  );
}
function IconItalic(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  );
}
function IconUnderline(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M6 4v7a6 6 0 0 0 12 0V4" />
      <line x1="4" y1="20" x2="20" y2="20" />
    </svg>
  );
}
function IconStrike(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <line x1="4" y1="12" x2="20" y2="12" />
      <path d="M16 6a4 4 0 0 0-4-2c-2.5 0-4 1.5-4 3.5 0 2 2 3 5 3" />
      <path d="M8 18a4 4 0 0 0 4 2c2.5 0 4-1.5 4-3.5 0-1-.5-2-1.5-2.5" />
    </svg>
  );
}
function IconH1(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M4 5v14" />
      <path d="M12 5v14" />
      <path d="M4 12h8" />
      <path d="M17 8l2-1v12" />
    </svg>
  );
}
function IconH2(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M4 5v14" />
      <path d="M12 5v14" />
      <path d="M4 12h8" />
      <path d="M16 9a2 2 0 0 1 4 0c0 2-4 3-4 7h4" />
    </svg>
  );
}
function IconQuote(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M6 7h4v6H6z" />
      <path d="M14 7h4v6h-4z" />
      <path d="M6 13c0 2 1 3 3 3" />
      <path d="M14 13c0 2 1 3 3 3" />
    </svg>
  );
}
function IconBulletList(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1.2" />
      <circle cx="4.5" cy="12" r="1.2" />
      <circle cx="4.5" cy="18" r="1.2" />
    </svg>
  );
}
function IconOrderedList(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <line x1="10" y1="6" x2="20" y2="6" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <line x1="10" y1="18" x2="20" y2="18" />
      <path d="M4 4h2v4" />
      <path d="M4 14h2a1 1 0 0 1 0 2H4l2 2" />
    </svg>
  );
}
function IconLink(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
    </svg>
  );
}
function IconHighlight(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M9 11l-4 4 2 2 4-4" />
      <path d="M11 9l4 4 5-5-4-4z" />
      <line x1="3" y1="21" x2="21" y2="21" />
    </svg>
  );
}
function IconChevronDown(): JSX.Element {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function IconSearch(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.5" y2="16.5" />
    </svg>
  );
}
function IconFocus(): JSX.Element {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M4 8V4h4" />
      <path d="M20 8V4h-4" />
      <path d="M4 16v4h4" />
      <path d="M20 16v4h-4" />
    </svg>
  );
}

// --- Divider -------------------------------------------------------------

function FbDivider(): JSX.Element {
  return <span aria-hidden="true" className="fb-divider mx-1.5 h-5 w-px bg-line" />;
}

// --- Style selector ------------------------------------------------------

interface StyleSelectorProps {
  editor: TiptapEditor | null;
}

function StyleSelector({ editor }: StyleSelectorProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const label = currentStyleLabel(editor);
  const disabled = editor === null;

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && wrapperRef.current.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onPick = (id: StyleOption['id']): void => {
    if (editor) applyStyle(editor, id);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-label="Paragraph style"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="fb-sel flex h-7 items-center gap-1 rounded-md px-2 font-serif text-[12.5px] text-ink-2 hover:bg-surface-hover disabled:opacity-50"
      >
        <span>{label}</span>
        <IconChevronDown />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Paragraph style"
          className="absolute left-0 top-full z-20 mt-1 w-[220px] rounded-md border border-line bg-bg-elevated py-1 shadow-pop"
        >
          {STYLE_OPTIONS.map((opt) => {
            const active = opt.label === label;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitem"
                aria-current={active ? 'true' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(opt.id)}
                className={`block w-full px-3 py-1.5 text-left font-serif text-[13px] hover:bg-surface-hover${
                  active ? ' bg-accent-soft text-ink' : ' text-ink-2'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Link popover --------------------------------------------------------

interface LinkPopoverProps {
  editor: TiptapEditor | null;
}

function LinkPopover({ editor }: LinkPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isActive = editor?.isActive('link') ?? false;
  const disabled = editor === null;

  // Seed input with the current link href when opening.
  useEffect(() => {
    if (!open) return;
    if (!editor) return;
    const existing = editor.getAttributes('link').href as string | undefined;
    setHref(existing ?? '');
    // Defer focus so the input exists in the DOM.
    queueMicrotask(() => {
      inputRef.current?.focus();
    });
  }, [open, editor]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && wrapperRef.current.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const apply = useCallback((): void => {
    if (!editor) return;
    const trimmed = href.trim();
    if (trimmed.length === 0) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
    setOpen(false);
  }, [editor, href]);

  const remove = useCallback((): void => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setOpen(false);
  }, [editor]);

  return (
    <div ref={wrapperRef} className="relative">
      <FbButton
        label="Link"
        isActive={isActive}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <IconLink />
      </FbButton>
      {open && (
        <div
          role="dialog"
          aria-label="Link"
          className="absolute left-0 top-full z-20 mt-1 flex w-[280px] items-center gap-1 rounded-md border border-line bg-bg-elevated p-2 shadow-pop"
        >
          <input
            ref={inputRef}
            type="url"
            placeholder="https://"
            aria-label="URL"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                apply();
              }
            }}
            className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 text-[12px] text-ink outline-none focus:border-line-2"
          />
          <button
            type="button"
            onClick={apply}
            disabled={href.trim().length === 0}
            className="rounded border border-line bg-bg px-2 py-1 text-[12px] text-ink hover:bg-surface-hover disabled:opacity-50"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={!isActive}
            className="rounded border border-line bg-bg px-2 py-1 text-[12px] text-ink hover:bg-surface-hover disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

// --- Main component -----------------------------------------------------

export function FormatBar({ editor, onToggleFind }: FormatBarProps): JSX.Element {
  const { isFocus, toggleFocus } = useFocusToggle();
  const disabled = editor === null;
  const canUndo = editor?.can().undo() ?? false;
  const canRedo = editor?.can().redo() ?? false;

  const isBold = editor?.isActive('bold') ?? false;
  const isItalic = editor?.isActive('italic') ?? false;
  const isUnderline = editor?.isActive('underline') ?? false;
  const isStrike = editor?.isActive('strike') ?? false;
  const isH1 = editor?.isActive('heading', { level: 1 }) ?? false;
  const isH2 = editor?.isActive('heading', { level: 2 }) ?? false;
  const isQuote = editor?.isActive('blockquote') ?? false;
  const isBullet = editor?.isActive('bulletList') ?? false;
  const isOrdered = editor?.isActive('orderedList') ?? false;
  const isHighlight = editor?.isActive('highlight') ?? false;

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="format-bar flex h-10 items-center gap-0.5 border-b border-line bg-bg px-6 py-1.5"
    >
      {/* Undo / Redo */}
      <FbButton
        label="Undo"
        disabled={disabled || !canUndo}
        onClick={() => editor?.chain().focus().undo().run()}
      >
        <IconUndo />
      </FbButton>
      <FbButton
        label="Redo"
        disabled={disabled || !canRedo}
        onClick={() => editor?.chain().focus().redo().run()}
      >
        <IconRedo />
      </FbButton>

      <FbDivider />

      {/* Style selector */}
      <StyleSelector editor={editor} />

      <FbDivider />

      {/* Bold / Italic / Underline / Strike */}
      <FbButton
        label="Bold"
        isActive={isBold}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <IconBold />
      </FbButton>
      <FbButton
        label="Italic"
        isActive={isItalic}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <IconItalic />
      </FbButton>
      <FbButton
        label="Underline"
        isActive={isUnderline}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleUnderline().run()}
      >
        <IconUnderline />
      </FbButton>
      <FbButton
        label="Strike"
        isActive={isStrike}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <IconStrike />
      </FbButton>

      <FbDivider />

      {/* H1 / H2 / Quote */}
      <FbButton
        label="Heading 1"
        isActive={isH1}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <IconH1 />
      </FbButton>
      <FbButton
        label="Heading 2"
        isActive={isH2}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <IconH2 />
      </FbButton>
      <FbButton
        label="Quote"
        isActive={isQuote}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <IconQuote />
      </FbButton>

      <FbDivider />

      {/* Bullet / Ordered list */}
      <FbButton
        label="Bullet list"
        isActive={isBullet}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <IconBulletList />
      </FbButton>
      <FbButton
        label="Numbered list"
        isActive={isOrdered}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <IconOrderedList />
      </FbButton>

      <FbDivider />

      {/* Link / Highlight */}
      <LinkPopover editor={editor} />
      <FbButton
        label="Highlight"
        isActive={isHighlight}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleHighlight().run()}
      >
        <IconHighlight />
      </FbButton>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Find / Focus */}
      <FbButton
        label="Find"
        onClick={() => onToggleFind?.()}
        disabled={onToggleFind === undefined}
        title={onToggleFind === undefined ? 'Find — coming in [X17]' : undefined}
      >
        <IconSearch />
      </FbButton>
      <FbButton label="Focus mode" isActive={isFocus} onClick={toggleFocus}>
        <IconFocus />
      </FbButton>
    </div>
  );
}
