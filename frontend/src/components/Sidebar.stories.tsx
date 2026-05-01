import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { SidebarTab } from '@/store/sidebarTab';
import { useSidebarTabStore } from '@/store/sidebarTab';
import { Sidebar } from './Sidebar';

function ResetTab({
  to,
  children,
}: {
  to: SidebarTab;
  children: React.ReactNode;
}): React.ReactElement {
  useEffect(() => {
    useSidebarTabStore.setState({ sidebarTab: to });
    return () => {
      useSidebarTabStore.setState({ sidebarTab: 'chapters' });
    };
  }, [to]);
  return <>{children}</>;
}

function withTab(tab: SidebarTab) {
  return (Story: () => React.ReactElement) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
          gcTime: Number.POSITIVE_INFINITY,
        },
      },
    });
    return (
      <QueryClientProvider client={client}>
        <ResetTab to={tab}>
          <div style={{ height: 640, width: 280, border: '1px solid var(--line)' }}>
            <Story />
          </div>
        </ResetTab>
      </QueryClientProvider>
    );
  };
}

const placeholderBody = (label: string): React.ReactNode => (
  <div className="p-3 font-sans text-[12.5px] text-ink-3">{label}</div>
);

const meta = {
  title: 'Components/Sidebar',
  component: Sidebar,
  args: {
    storyTitle: 'The Long Sky',
    totalWordCount: 18_400,
    goalWordCount: 80_000,
    chaptersCount: 9,
    castCount: 4,
    chaptersBody: placeholderBody('CHAPTERS panel body'),
    castBody: placeholderBody('CAST panel body'),
    outlineBody: placeholderBody('OUTLINE panel body'),
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [withTab('chapters')],
};

export const NoStory: Story = {
  args: {
    storyTitle: null,
    chaptersCount: null,
    castCount: null,
    chaptersBody: placeholderBody('— no story —'),
  },
  decorators: [withTab('chapters')],
};

export const NoGoal: Story = {
  args: { goalWordCount: undefined },
  decorators: [withTab('chapters')],
};

export const CastTabActive: Story = {
  decorators: [withTab('cast')],
};

export const OutlineTabActive: Story = {
  decorators: [withTab('outline')],
};

export const LongStoryTitle: Story = {
  args: {
    storyTitle: 'The Very Long Story Title That Should Truncate With An Ellipsis Inside The Picker',
  },
  decorators: [withTab('chapters')],
};
