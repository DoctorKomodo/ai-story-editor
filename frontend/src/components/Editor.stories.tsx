import type { Meta, StoryObj } from '@storybook/react-vite';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { JSX } from 'react';

/**
 * Minimum-viable TipTap demo wrapper for the Editor story. Mounts the same
 * StarterKit-only extension set the production `Editor` component uses for
 * F8, but skips the toolbar / word-count chrome — the point is to give
 * theme switches a prose surface to render against.
 */
function EditorDemo(): JSX.Element {
  const editor = useEditor({
    extensions: [StarterKit],
    content: `
      <h1>Threshold</h1>
      <p>Lyra paused at the threshold, weighing the cost of one more step.</p>
      <p>Behind her, the corridor breathed. Ahead, only the long, slow draw of cold air through stone.</p>
      <p><em>"You came back,"</em> Kade said, without turning.</p>
    `,
    editorProps: {
      attributes: {
        class:
          'min-h-[300px] w-full rounded border border-line bg-bg-elevated p-4 text-ink focus:outline-none transition-colors',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Demo prose',
      },
    },
  });

  return (
    <div style={{ width: 640 }}>
      <EditorContent editor={editor} />
    </div>
  );
}

const meta = {
  title: 'Components/Editor',
  component: EditorDemo,
} satisfies Meta<typeof EditorDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
