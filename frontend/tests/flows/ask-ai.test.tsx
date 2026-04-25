import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer, type SendArgs } from '@/components/ChatComposer';
import { ASK_AI_DRAFT, triggerAskAI } from '@/lib/askAi';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useComposerDraftStore } from '@/store/composerDraft';
import { useSelectionStore } from '@/store/selection';
import { useTweaksStore } from '@/store/tweaks';

afterEach(() => {
  act(() => {
    useAttachedSelectionStore.setState({ attachedSelection: null });
    useTweaksStore.setState({
      tweaks: { theme: 'paper', layout: 'three-col', proseFont: 'iowan' },
    });
    useSelectionStore.setState({ selection: null });
    useComposerDraftStore.setState({ draft: null, focusToken: 0 });
  });
});

describe('triggerAskAI flow (F41)', () => {
  it('attaches selection, opens chat, pre-fills draft, focuses composer, clears prose selection', async () => {
    act(() => {
      useTweaksStore.setState({
        tweaks: { theme: 'paper', layout: 'nochat', proseFont: 'iowan' },
      });
      useSelectionStore.setState({
        selection: { text: 'A passage', range: null, rect: null },
      });
    });

    const removeAllRanges = vi.fn();
    const getSelectionSpy = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ removeAllRanges } as unknown as Selection);

    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    act(() => {
      triggerAskAI({
        selectionText: 'A passage',
        chapter: { id: 'ch-1', number: 3, title: 'Storm' },
      });
    });

    expect(useAttachedSelectionStore.getState().attachedSelection).toEqual({
      text: 'A passage',
      chapter: { id: 'ch-1', number: 3, title: 'Storm' },
    });
    expect(useTweaksStore.getState().tweaks.layout).toBe('three-col');
    expect(useSelectionStore.getState().selection).toBeNull();
    expect(removeAllRanges).toHaveBeenCalled();

    expect(textarea.value).toBe(ASK_AI_DRAFT);
    expect(document.activeElement).toBe(textarea);

    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith({
      content: ASK_AI_DRAFT.trim(),
      attachment: {
        text: 'A passage',
        chapter: { id: 'ch-1', number: 3, title: 'Storm' },
      },
      mode: 'ask',
    } satisfies SendArgs);

    getSelectionSpy.mockRestore();
  });

  it('switches from focus layout to three-col', () => {
    act(() => {
      useTweaksStore.setState({
        tweaks: { theme: 'paper', layout: 'focus', proseFont: 'iowan' },
      });
    });
    render(<ChatComposer onSend={vi.fn()} />);

    act(() => {
      triggerAskAI({
        selectionText: 'x',
        chapter: { id: 'ch-1', number: 1, title: 'A' },
      });
    });

    expect(useTweaksStore.getState().tweaks.layout).toBe('three-col');
  });

  it('keeps three-col layout if already three-col', () => {
    const setTweaksSpy = vi.spyOn(useTweaksStore.getState(), 'setTweaks');
    render(<ChatComposer onSend={vi.fn()} />);

    act(() => {
      triggerAskAI({
        selectionText: 'x',
        chapter: { id: 'ch-1', number: 1, title: 'A' },
      });
    });

    expect(setTweaksSpy).not.toHaveBeenCalled();
    setTweaksSpy.mockRestore();
  });
});
