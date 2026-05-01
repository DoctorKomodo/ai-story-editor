// [F27] Sidebar shell — header, tabs row, scrollable body, progress footer.
// Tests the shell-only contract: slot wiring, story-picker callback, plus-
// button callback, tab-switching wired to `useSidebarTabStore`, panel
// `hidden` attribute, and progress-footer arithmetic / formatting.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar, type SidebarProps } from '@/components/Sidebar';
import { useSidebarTabStore } from '@/store/sidebarTab';

function resetSidebarTab(): void {
  useSidebarTabStore.setState({ sidebarTab: 'chapters' });
}

function renderSidebar(props: Partial<SidebarProps> = {}): void {
  render(
    <Sidebar
      storyTitle="The Long Sky"
      chaptersBody={<div data-testid="chapters-body">CHAPTERS</div>}
      {...props}
    />,
  );
}

describe('Sidebar', () => {
  afterEach(() => {
    resetSidebarTab();
  });

  it('renders all four landmarks: header, tabs row, body, footer', () => {
    renderSidebar();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-header')).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-body')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-footer')).toBeInTheDocument();
  });

  it('renders the story title in the header', () => {
    renderSidebar({ storyTitle: 'Mockingbird' });
    expect(screen.getByTestId('sidebar-story-picker')).toHaveTextContent('Mockingbird');
  });

  it('falls back to "No story" when storyTitle is null', () => {
    renderSidebar({ storyTitle: null });
    expect(screen.getByTestId('sidebar-story-picker')).toHaveTextContent('No story');
  });

  it('falls back to "No story" when storyTitle is empty string', () => {
    renderSidebar({ storyTitle: '' });
    expect(screen.getByTestId('sidebar-story-picker')).toHaveTextContent('No story');
  });

  it('clicking the story-picker fires onOpenStoryPicker', () => {
    const onOpenStoryPicker = vi.fn();
    renderSidebar({ onOpenStoryPicker });
    fireEvent.click(screen.getByTestId('sidebar-story-picker'));
    expect(onOpenStoryPicker).toHaveBeenCalledTimes(1);
  });

  it('does not render a sidebar-level + button (chapters owns its own add)', () => {
    renderSidebar();
    expect(screen.queryByTestId('sidebar-add-button')).toBeNull();
  });

  it('renders three tabs in correct order', () => {
    renderSidebar();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent('Chapters');
    expect(tabs[1]).toHaveTextContent('Cast');
    expect(tabs[2]).toHaveTextContent('Outline');
  });

  it('default active tab is Chapters', () => {
    renderSidebar();
    expect(screen.getByTestId('sidebar-tab-chapters')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('sidebar-tab-cast')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('sidebar-tab-outline')).toHaveAttribute('aria-selected', 'false');
  });

  it('clicking Cast flips the store and aria-selected', () => {
    renderSidebar();
    act(() => {
      fireEvent.click(screen.getByTestId('sidebar-tab-cast'));
    });
    expect(useSidebarTabStore.getState().sidebarTab).toBe('cast');
    expect(screen.getByTestId('sidebar-tab-cast')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('sidebar-tab-chapters')).toHaveAttribute('aria-selected', 'false');
  });

  it('only the active tab panel is visible (others have hidden attribute)', () => {
    renderSidebar();

    // Default: chapters active.
    expect(screen.getByTestId('sidebar-panel-chapters')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('sidebar-panel-cast')).toHaveAttribute('hidden');
    expect(screen.getByTestId('sidebar-panel-outline')).toHaveAttribute('hidden');

    act(() => {
      fireEvent.click(screen.getByTestId('sidebar-tab-outline'));
    });

    expect(screen.getByTestId('sidebar-panel-chapters')).toHaveAttribute('hidden');
    expect(screen.getByTestId('sidebar-panel-cast')).toHaveAttribute('hidden');
    expect(screen.getByTestId('sidebar-panel-outline')).not.toHaveAttribute('hidden');
  });

  it('renders chaptersBody in the chapters panel', () => {
    renderSidebar();
    expect(screen.getByTestId('chapters-body')).toBeInTheDocument();
  });

  it('renders default placeholders for cast and outline when not provided', () => {
    renderSidebar();
    expect(screen.getByTestId('sidebar-cast-placeholder')).toHaveTextContent('Coming in [F28]');
    expect(screen.getByTestId('sidebar-outline-placeholder')).toHaveTextContent('Coming in [F29]');
  });

  it('renders provided castBody and outlineBody instead of placeholders', () => {
    renderSidebar({
      castBody: <div data-testid="custom-cast">CAST</div>,
      outlineBody: <div data-testid="custom-outline">OUTLINE</div>,
    });
    expect(screen.getByTestId('custom-cast')).toBeInTheDocument();
    expect(screen.getByTestId('custom-outline')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-cast-placeholder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-outline-placeholder')).not.toBeInTheDocument();
  });

  it('progress footer renders "X / Y words · Z%" when both totals are set', () => {
    renderSidebar({ totalWordCount: 1234, goalWordCount: 50000 });
    expect(screen.getByTestId('sidebar-progress-text')).toHaveTextContent(
      '1,234 / 50,000 words · 2%',
    );
  });

  it('progress footer renders just "X words" when goalWordCount is undefined', () => {
    renderSidebar({ totalWordCount: 1234 });
    expect(screen.getByTestId('sidebar-progress-text')).toHaveTextContent('1,234 words');
    expect(screen.getByTestId('sidebar-progress-text').textContent).not.toContain('/');
    expect(screen.queryByTestId('sidebar-progress-bar')).not.toBeInTheDocument();
  });

  it('progress footer defaults word count to 0 when totalWordCount is undefined', () => {
    renderSidebar();
    expect(screen.getByTestId('sidebar-progress-text')).toHaveTextContent('0 words');
  });

  it('progress bar inner div uses correct width style', () => {
    renderSidebar({ totalWordCount: 12500, goalWordCount: 50000 });
    const bar = screen.getByTestId('sidebar-progress-bar');
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    const fill = screen.getByTestId('sidebar-progress-fill');
    expect(fill).toHaveStyle({ width: '25%' });
  });

  it('progress bar caps at 100% when over goal', () => {
    renderSidebar({ totalWordCount: 100000, goalWordCount: 50000 });
    expect(screen.getByTestId('sidebar-progress-text')).toHaveTextContent(
      '100,000 / 50,000 words · 100%',
    );
    expect(screen.getByTestId('sidebar-progress-fill')).toHaveStyle({ width: '100%' });
  });

  it('hides the progress bar when goalWordCount is 0', () => {
    renderSidebar({ totalWordCount: 1234, goalWordCount: 0 });
    expect(screen.queryByTestId('sidebar-progress-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-progress-text')).toHaveTextContent('1,234 words');
  });

  it('renders count line under CHAPTERS and CAST when counts are provided', () => {
    renderSidebar({ chaptersCount: 9, castCount: 4 });
    expect(within(screen.getByTestId('sidebar-tab-chapters')).getByText('9')).toBeInTheDocument();
    expect(within(screen.getByTestId('sidebar-tab-cast')).getByText('4')).toBeInTheDocument();
  });

  it('OUTLINE never renders a count', () => {
    renderSidebar({ chaptersCount: 5, castCount: 2 });
    const outlineTab = screen.getByTestId('sidebar-tab-outline');
    expect(outlineTab.textContent).toBe('Outline');
  });

  it('omits the count when null (loading)', () => {
    renderSidebar({ chaptersCount: null, castCount: null });
    expect(screen.getByTestId('sidebar-tab-chapters').textContent).toBe('Chapters');
    expect(screen.getByTestId('sidebar-tab-cast').textContent).toBe('Cast');
  });

  it('tab aria-label includes the count for screen readers', () => {
    renderSidebar({ chaptersCount: 9, castCount: 4 });
    expect(screen.getByTestId('sidebar-tab-chapters')).toHaveAttribute(
      'aria-label',
      'Chapters (9)',
    );
    expect(screen.getByTestId('sidebar-tab-cast')).toHaveAttribute('aria-label', 'Cast (4)');
    expect(screen.getByTestId('sidebar-tab-outline')).not.toHaveAttribute('aria-label');
  });
});
