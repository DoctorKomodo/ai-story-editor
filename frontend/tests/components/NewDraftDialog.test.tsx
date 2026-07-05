import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import type { Draft } from 'story-editor-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveViewedIsActive, NewDraftDialog } from '@/components/NewDraftDialog';
import { resetApiClientForTests } from '@/lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const createdDraft: Draft = {
  id: 'd-new',
  chapterId: 'ch-1',
  label: null,
  wordCount: 0,
  orderIndex: 3,
  isActive: false,
  hasSummary: false,
  summaryIsStale: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  bodyJson: null,
  summary: null,
  summaryUpdatedAt: null,
};

function renderDialog(overrides: Partial<{ viewedIsActive: boolean; draftCount: number }> = {}): {
  onClose: ReturnType<typeof vi.fn>;
  onCreated: ReturnType<typeof vi.fn>;
} {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(
    <NewDraftDialog
      chapterId="ch-1"
      storyId="story-1"
      draftCount={overrides.draftCount ?? 3}
      viewedIsActive={overrides.viewedIsActive ?? true}
      onClose={onClose}
      onCreated={onCreated}
    />,
    { wrapper },
  );
  return { onClose, onCreated };
}

describe('NewDraftDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetApiClientForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientForTests();
  });

  it('fork is the default mode; the name placeholder is the next positional label', () => {
    renderDialog({ draftCount: 3 });
    expect(screen.getByRole('radio', { name: 'Fork current draft' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Start blank' })).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: /name/i })).toHaveAttribute(
      'placeholder',
      'Draft D',
    );
  });

  it('says "Fork active draft" when the viewed draft is not the active one (D5)', () => {
    renderDialog({ viewedIsActive: false });
    expect(screen.getByRole('radio', { name: 'Fork active draft' })).toBeChecked();
  });

  it('creating with an empty name POSTs {mode} only, then onCreated + onClose', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { draft: createdDraft }));
    const { onClose, onCreated } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(createdDraft);
    });
    expect(onClose).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/chapters/ch-1/drafts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'fork' });
  });

  it('blank mode + custom name POSTs {mode: blank, label}', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { draft: createdDraft }));
    renderDialog();

    await userEvent.click(screen.getByRole('radio', { name: 'Start blank' }));
    await userEvent.type(screen.getByRole('textbox', { name: /name/i }), '  Clean rewrite  ');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'blank', label: 'Clean rewrite' });
  });

  it('a failed create keeps the dialog open and shows an inline error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, { error: { message: 'boom', code: 'internal' } }),
    );
    const { onClose, onCreated } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not create/i);
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel closes without POSTing', async () => {
    const { onClose } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('while a create is pending, Escape does not dismiss and the name input is disabled', async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {})); // never resolves
    const { onClose } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /name/i })).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();

    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('deriveViewedIsActive', () => {
  it('true when the dialog targets the open chapter and the viewed draft is its active one', () => {
    expect(
      deriveViewedIsActive({
        dialogChapterId: 'ch-1',
        activeChapterId: 'ch-1',
        viewedDraftId: 'd-active',
        activeDraftId: 'd-active',
      }),
    ).toBe(true);
  });

  it('false when the viewed draft of the open chapter is not the active one', () => {
    expect(
      deriveViewedIsActive({
        dialogChapterId: 'ch-1',
        activeChapterId: 'ch-1',
        viewedDraftId: 'd-other',
        activeDraftId: 'd-active',
      }),
    ).toBe(false);
  });

  it('false for a chapter that is not open in the editor, regardless of the viewed draft (D5)', () => {
    expect(
      deriveViewedIsActive({
        dialogChapterId: 'ch-2',
        activeChapterId: 'ch-1',
        viewedDraftId: 'd-active',
        activeDraftId: 'd-active',
      }),
    ).toBe(false);
    expect(
      deriveViewedIsActive({
        dialogChapterId: 'ch-2',
        activeChapterId: null,
        viewedDraftId: null,
        activeDraftId: null,
      }),
    ).toBe(false);
  });

  it('false while the drafts list has not resolved (both ids null must not compare equal)', () => {
    expect(
      deriveViewedIsActive({
        dialogChapterId: 'ch-1',
        activeChapterId: 'ch-1',
        viewedDraftId: null,
        activeDraftId: null,
      }),
    ).toBe(false);
  });
});
