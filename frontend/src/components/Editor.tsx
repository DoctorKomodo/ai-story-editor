import type { JSONContent, Editor as TiptapEditor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';

/**
 * TipTap editor (F8).
 *
 * Owns the editor mount, a plain formatting toolbar (bold / italic /
 * headings 1-3 / paragraph), and a word-count footer.
 *
 * The word-count rule matches the backend's `computeWordCount`
 * (see `backend/src/routes/chapters.routes.ts` + `tiptap-text.ts`):
 * extract plain text from the TipTap doc, `trim()`, and if empty return 0,
 * otherwise split on `/\s+/`. TipTap's `editor.getText()` joins block
 * contents with newlines, which after `trim()` + `split(/\s+/)` lands on
 * the same count as the backend extractor for plain content.
 *
 * F9 will wire `onUpdate` to a debounced PATCH. F31/F32 redo the
 * toolbar + paper layout to mockup spec; F34 adds the selection bubble.
 *
 * `onReady` is provided mainly as a test hook — jsdom doesn't route
 * keystrokes through contenteditable the same way a real browser does,
 * so tests drive content via `editor.commands.*` rather than user-event
 * typing. It's a narrow, documented escape hatch; no other consumer is
 * expected to reach in directly.
 */
export interface EditorProps {
  initialBodyJson?: JSONContent | null;
  onUpdate?: (args: { bodyJson: JSONContent; wordCount: number }) => void;
  onReady?: (editor: TiptapEditor) => void;
}

const DEFAULT_EMPTY_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

interface ToolbarButtonProps {
  label: string;
  onClick: () => void;
  isActive: boolean;
  children: React.ReactNode;
}

function ToolbarButton({ label, onClick, isActive, children }: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isActive}
      onClick={onClick}
      className={
        isActive
          ? 'rounded border border-ink bg-accent-soft px-2 py-1 font-sans text-[12.5px] font-medium text-ink transition-colors'
          : 'rounded border border-line bg-bg-elevated px-2 py-1 font-sans text-[12.5px] font-medium text-ink-2 hover:bg-surface-hover hover:text-ink transition-colors'
      }
    >
      {children}
    </button>
  );
}

export function Editor({ initialBodyJson, onUpdate, onReady }: EditorProps): JSX.Element {
  // `useEditor` already memoises internally on the dependency array, but
  // StarterKit is config-free for F8 so we build the extension list once.
  // See CLAUDE.md "Known Gotchas" — useEditor needs a stable reference.
  const extensions = useMemo(() => [StarterKit], []);

  // `useEditor` wires callbacks at mount and does not re-subscribe when
  // its options object changes, so a prop callback captured directly would
  // go stale if the parent re-renders with a new function reference. Route
  // through a ref so the latest prop is always called.
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const editor = useEditor({
    extensions,
    content: initialBodyJson ?? DEFAULT_EMPTY_DOC,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        // Tailwind `prose` would be nice here but F32 handles typography.
        class:
          'min-h-[300px] w-full rounded border border-line bg-bg-elevated p-4 text-ink focus:outline-none focus:border-ink-3 transition-colors',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Chapter body',
      },
    },
    onUpdate({ editor: ed }) {
      const cb = onUpdateRef.current;
      if (!cb) return;
      const json = ed.getJSON();
      const wordCount = countWords(ed.getText());
      cb({ bodyJson: json, wordCount });
    },
  });

  // Surface the editor instance to consumers that need deterministic
  // control (primarily tests). Fire once when the editor first mounts;
  // use a ref to avoid re-firing on parent-provided callback identity
  // changes, and guard against double-fire in React StrictMode.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  const readyFiredFor = useRef<TiptapEditor | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (readyFiredFor.current === editor) return;
    readyFiredFor.current = editor;
    onReadyRef.current?.(editor);
  }, [editor]);

  // Swap content when the controlled prop changes (e.g. F9 loads a
  // different chapter). Skip if the current content already matches —
  // `setContent` would otherwise reset selection / history unnecessarily.
  useEffect(() => {
    if (!editor || !initialBodyJson) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(initialBodyJson)) {
      editor.commands.setContent(initialBodyJson, { emitUpdate: false });
    }
  }, [editor, initialBodyJson]);

  const wordCount = editor ? countWords(editor.getText()) : 0;
  const wordLabel = wordCount === 1 ? '1 word' : `${wordCount} words`;

  return (
    <div className="flex flex-col gap-3">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-1">
        <ToolbarButton
          label="Bold"
          isActive={editor?.isActive('bold') ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <span className="font-bold">B</span>
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          isActive={editor?.isActive('italic') ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <span className="italic">I</span>
        </ToolbarButton>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line-2" />
        <ToolbarButton
          label="Heading 1"
          isActive={editor?.isActive('heading', { level: 1 }) ?? false}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </ToolbarButton>
        <ToolbarButton
          label="Heading 2"
          isActive={editor?.isActive('heading', { level: 2 }) ?? false}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          label="Heading 3"
          isActive={editor?.isActive('heading', { level: 3 }) ?? false}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H3
        </ToolbarButton>
        <ToolbarButton
          label="Paragraph"
          isActive={editor?.isActive('paragraph') ?? false}
          onClick={() => editor?.chain().focus().setParagraph().run()}
        >
          P
        </ToolbarButton>
      </div>

      <EditorContent editor={editor} />

      <div
        role="status"
        data-testid="editor-word-count"
        className="border-t border-line pt-2 font-mono text-[11px] text-ink-3"
      >
        {wordLabel}
      </div>
    </div>
  );
}
