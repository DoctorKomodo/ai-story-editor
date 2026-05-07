import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneComposer } from '@/components/SceneComposer';

describe('SceneComposer', () => {
  let onGenerate: ReturnType<typeof vi.fn>;
  let onStop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onGenerate = vi.fn();
    onStop = vi.fn();
  });

  it('shows Generate and a placeholder when idle', () => {
    render(<SceneComposer state="idle" onGenerate={onGenerate} onStop={onStop} />);
    expect(screen.getByPlaceholderText(/describe a scene/i)).toBeInTheDocument();
    // generate exists; whether it's enabled depends on input — empty initially → disabled.
    expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
  });

  it('calls onGenerate with composed text on click', async () => {
    const user = userEvent.setup();
    render(<SceneComposer state="idle" onGenerate={onGenerate} onStop={onStop} />);
    await user.type(
      screen.getByRole('textbox', { name: /scene direction/i }),
      'Jenny on the veranda',
    );
    await user.click(screen.getByRole('button', { name: /generate/i }));
    expect(onGenerate).toHaveBeenCalledWith('Jenny on the veranda');
  });

  it('disables generate when textarea is empty', () => {
    render(<SceneComposer state="idle" onGenerate={onGenerate} onStop={onStop} />);
    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
  });

  it('shows Stop when streaming and calls onStop on click', async () => {
    const user = userEvent.setup();
    render(<SceneComposer state="streaming" onGenerate={onGenerate} onStop={onStop} />);
    expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('locks the textarea while streaming', () => {
    render(<SceneComposer state="streaming" onGenerate={onGenerate} onStop={onStop} />);
    expect(screen.getByRole('textbox', { name: /scene direction/i })).toBeDisabled();
  });

  it('triggers onGenerate on Cmd+Enter / Ctrl+Enter', async () => {
    const user = userEvent.setup();
    render(<SceneComposer state="idle" onGenerate={onGenerate} onStop={onStop} />);
    const ta = screen.getByRole('textbox', { name: /scene direction/i });
    await user.type(ta, 'a');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onGenerate).toHaveBeenCalledWith('a');
  });
});
