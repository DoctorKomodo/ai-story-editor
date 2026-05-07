import type { Meta, StoryObj } from '@storybook/react-vite';
import { type SceneSession, SceneSessionPicker } from './SceneSessionPicker';

const sessions: SceneSession[] = [
  {
    id: 's1',
    title: 'Veranda confrontation',
    updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  {
    id: 's2',
    title: 'Cellar discovery',
    updatedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
];

const meta: Meta<typeof SceneSessionPicker> = {
  title: 'Chat/SceneSessionPicker',
  component: SceneSessionPicker,
  args: {
    sessions,
    activeSessionId: 's1',
    onSelect: () => {},
    onRename: () => {},
    onDelete: () => {},
    onNew: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 360, position: 'relative' }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof SceneSessionPicker>;

export const Default: Story = {};
export const Empty: Story = { args: { sessions: [], activeSessionId: null } };
