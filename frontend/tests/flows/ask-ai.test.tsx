import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatComposer, type SendArgs } from '@/components/ChatComposer';
import { ASK_AI_DRAFT, triggerAskAI } from '@/lib/askAi';
import { createQueryClient } from '@/lib/queryClient';
import { useAttachedSelectionStore } from '@/store/attachedSelection';
import { useComposerDraftStore } from '@/store/composerDraft';
import { useSelectionStore } from '@/store/selection';
import { useUiStore } from '@/store/ui';

function renderWithQuery(ui: ReactNode): void {
  const qc = createQueryClient();
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  act(() => {
    useAttachedSelectionStore.setState({ attachedSelection: null });
    useUiStore.setState({ layout: 'three-col' });
    useSelectionStore.setState({ selection: null });
    useComposerDraftStore.setState({ draft: null, focusToken: 0 });
  });
});

describe('triggerAskAI flow (F41)', () => {
  it('attaches selection, opens chat, pre-fills draft, focuses composer, clears prose selection', async () => {
    act(() => {
      useUiStore.setState({ layout: 'nochat' });
      useSelectionStore.setState({
        selection: { text: 'A passage', range: null, rect: null },
      });
    });

    const removeAllRanges = vi.fn();
    const getSelectionSpy = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ removeAllRanges } as unknown as Selection);

    const onSend = vi.fn();
    renderWithQuery(<ChatComposer onSend={onSend} />);
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
    expect(useUiStore.getState().layout).toBe('three-col');
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
      enableWebSearch: false,
    } satisfies SendArgs);

    getSelectionSpy.mockRestore();
  });

  it('switches from focus layout to three-col', () => {
    act(() => {
      useUiStore.setState({ layout: 'focus' });
    });
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);

    act(() => {
      triggerAskAI({
        selectionText: 'x',
        chapter: { id: 'ch-1', number: 1, title: 'A' },
      });
    });

    expect(useUiStore.getState().layout).toBe('three-col');
  });

  it('keeps three-col layout if already three-col', () => {
    const setLayoutSpy = vi.spyOn(useUiStore.getState(), 'setLayout');
    renderWithQuery(<ChatComposer onSend={vi.fn()} />);

    act(() => {
      triggerAskAI({
        selectionText: 'x',
        chapter: { id: 'ch-1', number: 1, title: 'A' },
      });
    });

    expect(setLayoutSpy).not.toHaveBeenCalled();
    setLayoutSpy.mockRestore();
  });
});
