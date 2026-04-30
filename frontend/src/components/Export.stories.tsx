import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ExportStory } from './Export';
import { Export } from './Export';

const sampleStory: ExportStory = {
  id: 's1',
  title: 'The Cartographer',
  chapters: [
    {
      id: 'c1',
      title: 'Threshold',
      orderIndex: 0,
      bodyJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Lyra paused at the threshold.' }],
          },
        ],
      },
    },
    {
      id: 'c2',
      title: 'Descent',
      orderIndex: 1,
      bodyJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Down she went.' }],
          },
        ],
      },
    },
  ],
};

const meta = {
  title: 'Components/Export',
  component: Export,
  args: { story: sampleStory, activeChapterId: 'c1' },
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
