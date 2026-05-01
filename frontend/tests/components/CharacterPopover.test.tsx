import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterPopover } from '@/components/CharacterPopover';
import type { Character } from '@/hooks/useCharacters';

/**
 * F37 tests.
 *
 * The popover only positions itself from `anchorEl.getBoundingClientRect()`
 * — jsdom returns zeros by default, so each test that needs real
 * coordinates stubs the rect on a fixture element.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    storyId: 'story-1',
    name: 'Elena',
    role: 'Protagonist',
    age: '32',
    appearance: 'Tall, with auburn hair',
    voice: 'Measured and warm',
    arc: 'From doubt to conviction',
    personality: 'Curious',
    orderIndex: 0,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeAnchor(rect?: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('span');
  document.body.appendChild(el);
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        top: 100,
        bottom: 120,
        left: 50,
        right: 100,
        width: 50,
        height: 20,
        x: 50,
        y: 100,
        toJSON: () => ({}),
        ...rect,
      }) as DOMRect,
  });
  return el;
}

interface HarnessProps {
  character?: Character | null;
  anchorEl?: HTMLElement | null;
  onClose?: () => void;
  onEdit?: (id: string) => void;
  onConsistencyCheck?: (id: string) => void;
  consistencyEnabled?: boolean;
}

function Harness(props: HarnessProps): JSX.Element {
  const character = 'character' in props ? (props.character as Character | null) : makeCharacter();
  const anchorEl = 'anchorEl' in props ? (props.anchorEl as HTMLElement | null) : null;
  return (
    <CharacterPopover
      character={character}
      anchorEl={anchorEl}
      onClose={props.onClose ?? (() => undefined)}
      onEdit={props.onEdit}
      onConsistencyCheck={props.onConsistencyCheck}
      consistencyEnabled={props.consistencyEnabled}
    />
  );
}

describe('CharacterPopover (F37)', () => {
  it('renders nothing when character is null', () => {
    render(<Harness character={null} anchorEl={makeAnchor()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing when anchorEl is null', () => {
    render(<Harness character={makeCharacter()} anchorEl={null} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders name and "role · Age N" caption', () => {
    render(<Harness anchorEl={makeAnchor()} />);
    const dialog = screen.getByRole('dialog', { name: 'Character: Elena' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText('Elena')).toBeTruthy();
    expect(screen.getByText('Protagonist · Age 32')).toBeTruthy();
  });

  it('renders all three fields with their values', () => {
    render(<Harness anchorEl={makeAnchor()} />);
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Voice')).toBeTruthy();
    expect(screen.getByText('Arc')).toBeTruthy();
    expect(screen.getByText('Tall, with auburn hair')).toBeTruthy();
    expect(screen.getByText('Measured and warm')).toBeTruthy();
    expect(screen.getByText('From doubt to conviction')).toBeTruthy();
  });

  it('renders em-dash placeholders for blank fields', () => {
    render(
      <Harness
        anchorEl={makeAnchor()}
        character={makeCharacter({ appearance: null, voice: '', arc: '   ' })}
      />,
    );
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBe(3);
  });

  it('omits caption parts that are missing', () => {
    render(
      <Harness anchorEl={makeAnchor()} character={makeCharacter({ role: null, age: '40' })} />,
    );
    expect(screen.getByText('Age 40')).toBeTruthy();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it('falls back to "Untitled" when name is blank', () => {
    render(<Harness anchorEl={makeAnchor()} character={makeCharacter({ name: '' })} />);
    expect(screen.getByRole('dialog', { name: 'Character: Untitled' })).toBeTruthy();
  });

  it('positions itself from anchorEl.getBoundingClientRect()', () => {
    const anchor = makeAnchor({ top: 200, bottom: 220, left: 80 });
    render(<Harness anchorEl={anchor} />);
    const dialog = screen.getByRole('dialog');
    const top = (dialog as HTMLElement).style.top;
    const left = (dialog as HTMLElement).style.left;
    // bottom (220) + scrollY (0) + gap (6) = 226
    expect(top).toBe('226px');
    // left (80) + scrollY (0) = 80
    expect(left).toBe('80px');
  });

  it('clamps left so the 280px popover stays inside the viewport', () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
    try {
      const anchor = makeAnchor({ top: 100, bottom: 120, left: 500 });
      render(<Harness anchorEl={anchor} />);
      const dialog = screen.getByRole('dialog');
      const left = parseInt((dialog as HTMLElement).style.left, 10);
      // Max left = 600 - 280 - 8 = 312. Anchor's 500 should clamp down.
      expect(left).toBeLessThanOrEqual(312);
      expect(left).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  });

  it('calls onEdit(id) when Edit is clicked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<Harness anchorEl={makeAnchor()} onEdit={onEdit} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith('char-1');
  });

  it('hides the Consistency check button by default', () => {
    render(<Harness anchorEl={makeAnchor()} />);
    expect(screen.queryByRole('button', { name: 'Consistency check' })).toBeNull();
  });

  it('shows the Consistency check button when consistencyEnabled is true', async () => {
    const user = userEvent.setup();
    const onConsistencyCheck = vi.fn();
    render(
      <Harness
        anchorEl={makeAnchor()}
        consistencyEnabled
        onConsistencyCheck={onConsistencyCheck}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Consistency check' });
    await user.click(btn);
    expect(onConsistencyCheck).toHaveBeenCalledWith('char-1');
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<Harness anchorEl={makeAnchor()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on outside mousedown', () => {
    const onClose = vi.fn();
    render(<Harness anchorEl={makeAnchor()} onClose={onClose} />);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when the popover itself is clicked', () => {
    const onClose = vi.fn();
    render(<Harness anchorEl={makeAnchor()} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not call onClose when the anchor itself is clicked', () => {
    const onClose = vi.fn();
    const anchor = makeAnchor();
    render(<Harness anchorEl={anchor} onClose={onClose} />);
    fireEvent.mouseDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
  });
});
