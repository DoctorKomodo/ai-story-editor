import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JSONContent } from '@tiptap/core';
import type { ExportStory } from './Export';
import { Export } from './Export';

// Storybook-only: bodies are resolved on click, but the menu doesn't fetch
// at mount. Map ids to fixture bodies so the click-to-download path produces
// non-empty .txt files in the story preview.
const FIXTURE_BODIES: Record<string, JSONContent> = {
  c1: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Lyra paused at the threshold.' }] },
    ],
  },
  c2: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Down she went.' }] }],
  },
};

const sampleStory: ExportStory = {
  id: 's1',
  title: 'The Cartographer',
  chapters: [
    { id: 'c1', title: 'Threshold', orderIndex: 0 },
    { id: 'c2', title: 'Descent', orderIndex: 1 },
  ],
};

const resolveBody = async (chapterId: string): Promise<JSONContent | null> =>
  FIXTURE_BODIES[chapterId] ?? null;

const meta = {
  title: 'Components/Export',
  component: Export,
  args: { story: sampleStory, activeChapterId: 'c1', resolveBody },
  decorators: [
    (Story) => (
      <div style={{ width: 320, padding: 32 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Export>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Closed by default. Click "Export" to expand the menu.
 */
export const Default: Story = {};

/**
 * No active chapter — the "Export chapter" menu item is disabled when opened.
 */
export const NoActiveChapter: Story = {
  args: { activeChapterId: null },
};
