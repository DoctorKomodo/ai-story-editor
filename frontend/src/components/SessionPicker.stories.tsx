import type { Meta, StoryObj } from '@storybook/react-vite';
import { type Session, SessionPicker } from './SessionPicker';

const sessions: Session[] = [
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

const SCENE_LABELS = {
  kindLabel: 'SCENE',
  ariaPrefix: 'Scene session: ',
  dropdownHeader: 'Scenes in this chapter',
  newButtonLabel: 'New scene',
} as const;

const meta: Meta<typeof SessionPicker> = {
  title: 'Chat/SessionPicker',
  component: SessionPicker,
  args: {
    sessions,
    activeSessionId: 's1',
    labels: SCENE_LABELS,
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
type Story = StoryObj<typeof SessionPicker>;

export const Default: Story = {};
export const Empty: Story = { args: { sessions: [], activeSessionId: null } };

const CHAT_LABELS = {
  kindLabel: 'CHAT',
  ariaPrefix: 'Chat: ',
  dropdownHeader: 'Chats in this chapter',
  newButtonLabel: 'New chat',
} as const;

export const ChatLabels: Story = {
  args: {
    labels: CHAT_LABELS,
    sessions: [
      {
        id: 'c1',
        title: 'On the cellar discovery',
        updatedAt: new Date(Date.now() - 1_800_000).toISOString(),
      },
      {
        id: 'c2',
        title: 'Pacing notes',
        updatedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
      },
    ],
    activeSessionId: 'c1',
  },
};
