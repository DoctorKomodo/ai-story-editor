import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/components/TopBar';
import { useTweaksStore } from '@/store/tweaks';

const baseProps = {
  username: 'alice',
  onSignOut: vi.fn(),
} as const;

describe('F26 · TopBar component', () => {
  beforeEach(() => {
    // Reset layout to the default before every test so the Focus button
    // assertion exercises a real flip from `three-col` -> `focus`.
    useTweaksStore.setState({
      tweaks: { theme: 'paper', layout: 'three-col', proseFont: 'iowan' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the brand text and brand-mark svg', () => {
    const { container } = render(<TopBar {...baseProps} />);
    expect(screen.getByText('Inkwell')).toBeInTheDocument();
    const brand = container.querySelector('.brand');
    expect(brand).not.toBeNull();
    expect(brand?.querySelector('svg')).not.toBeNull();
  });

  it('renders the breadcrumb trail when story + chapter info is supplied', () => {
    render(
      <TopBar
        {...baseProps}
        storyTitle="The Long Dawn"
        chapterNumber={3}
        chapterTitle="The Smoking Mirror"
      />,
    );
    const crumbs = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(within(crumbs).getByText('The Long Dawn')).toBeInTheDocument();
    expect(within(crumbs).getByText('Ch 3')).toBeInTheDocument();
    expect(within(crumbs).getByText('The Smoking Mirror')).toBeInTheDocument();
    expect(within(crumbs).getAllByText('/').length).toBe(2);
  });

  it('omits breadcrumbs when storyTitle is null', () => {
    render(<TopBar {...baseProps} />);
    const crumbs = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(crumbs).toBeEmptyDOMElement();
  });

  it('renders the saved-state indicator with the relative timestamp', () => {
    render(<TopBar {...baseProps} saveState="saved" savedAtRelative="12s ago" />);
    expect(screen.getByText(/Saved · 12s ago/)).toBeInTheDocument();
  });

  it('renders the word count formatted with a thousands separator', () => {
    render(<TopBar {...baseProps} wordCount={12345} />);
    expect(screen.getByText('12,345 words')).toBeInTheDocument();
  });

  it('omits the word count when wordCount is null', () => {
    render(<TopBar {...baseProps} wordCount={null} />);
    expect(screen.queryByText(/words$/)).not.toBeInTheDocument();
  });

  it('renders the History, Focus, and Settings icon buttons with aria-labels', () => {
    render(<TopBar {...baseProps} />);
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows the user-initial avatar derived from the username', () => {
    render(<TopBar {...baseProps} username="alice" />);
    const avatar = screen.getByRole('button', { name: 'alice' });
    expect(avatar).toHaveTextContent('A');
  });

  it('clicking the avatar opens the user menu with the @username header and standard items', async () => {
    render(<TopBar {...baseProps} username="alice" />);
    await userEvent.click(screen.getByRole('button', { name: 'alice' }));
    expect(screen.getByRole('menu', { name: /user menu/i })).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^settings$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /your stories/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /account & privacy/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('clicking Sign out invokes the onSignOut callback', async () => {
    const onSignOut = vi.fn();
    render(<TopBar {...baseProps} onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole('button', { name: 'alice' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('clicking the Focus icon flips the layout slice via useFocusToggle', async () => {
    render(<TopBar {...baseProps} />);
    expect(useTweaksStore.getState().tweaks.layout).toBe('three-col');
    await userEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(useTweaksStore.getState().tweaks.layout).toBe('focus');
    // Toggling again returns to three-col.
    await userEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(useTweaksStore.getState().tweaks.layout).toBe('three-col');
  });

  it('marks the Focus button as pressed/active when layout is focus', () => {
    useTweaksStore.setState({
      tweaks: { theme: 'paper', layout: 'focus', proseFont: 'iowan' },
    });
    render(<TopBar {...baseProps} />);
    const focusBtn = screen.getByRole('button', { name: 'Focus' });
    expect(focusBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking Settings (top-bar icon) invokes onOpenSettings', async () => {
    const onOpenSettings = vi.fn();
    render(<TopBar {...baseProps} onOpenSettings={onOpenSettings} />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('clicking History invokes onToggleHistory', async () => {
    const onToggleHistory = vi.fn();
    render(<TopBar {...baseProps} onToggleHistory={onToggleHistory} />);
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(onToggleHistory).toHaveBeenCalledTimes(1);
  });

  it('clicking outside the open user menu closes it', async () => {
    render(
      <div>
        <button type="button" data-testid="outside">
          Outside
        </button>
        <TopBar {...baseProps} />
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'alice' }));
    expect(screen.queryByRole('menu', { name: /user menu/i })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu', { name: /user menu/i })).not.toBeInTheDocument();
  });

  it('Escape closes the open user menu', async () => {
    render(<TopBar {...baseProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'alice' }));
    expect(screen.queryByRole('menu', { name: /user menu/i })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: /user menu/i })).not.toBeInTheDocument();
  });

  it('renders the failed save indicator when saveState is failed', () => {
    render(<TopBar {...baseProps} saveState="failed" />);
    expect(screen.getByText(/save failed/i)).toBeInTheDocument();
  });

  it('renders the saving indicator when saveState is saving', () => {
    render(<TopBar {...baseProps} saveState="saving" />);
    expect(screen.getByText('Saving…')).toBeInTheDocument();
  });
});
