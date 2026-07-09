# Drafts Editor Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Presentational polish of the chapter-drafts editor — chapter title as the header, live per-draft word count, no genre in the status line, and a jitter-free chapter row (story-editor-322 items 1–4).

**Architecture:** Frontend-only changes to two components. `Paper.tsx` (editor surface) gets a header/status-line rework; `ChapterList.tsx` (sidebar) adopts `DraftList`'s always-mounted + opacity action pattern so rows never reflow. No backend, schema, Prisma, or shared-package changes — `Draft.wordCount` is already server-authoritative and per-draft.

**Tech Stack:** React 19, TypeScript (strict), TipTap, TailwindCSS v4 (token-only via `@theme`), Vitest + Testing Library (jsdom), Storybook.

**Spec:** `docs/superpowers/specs/2026-07-09-drafts-editor-polish-design.md`

## Global Constraints

- Frontend-only. No changes to `backend/`, `shared/`, Prisma, or migrations.
- TypeScript strict mode; no `any`.
- Styles must be token-only (`--ink-*`, `--bg-*`, `var(--accent-soft)`, etc.) — the `lint:design` guard (`frontend/scripts/lint-design.mjs`) fails on raw colors.
- Frontend components: PascalCase files; hooks/lib camelCase.
- Reveal-on-hover uses the shared `revealOnRowHover` fragment (`frontend/src/design/primitives.tsx:692`) — do not hand-roll opacity classes.
- Full verify (run at the end): `npm --prefix frontend run typecheck && npm --prefix frontend run test && npm --prefix frontend run lint:design`. Frontend vitest is jsdom — no docker stack required.
- Commit after each passing step group. Commit message prefix: `[story-editor-322]`.

---

### Task 1: Paper editor surface — chapter-title header, live word count, no genre (items 1–3)

**Files:**
- Modify: `frontend/src/components/Paper.tsx` (`PaperProps` 35-58; `SubRow` 76-128; `ChapterTitleInput` input className 185; `Paper` signature 190-204; editor `onUpdate` 257-263; render 302-343)
- Modify: `frontend/src/pages/EditorPage.tsx` (Paper props at 811-815)
- Test (rewrite): `frontend/tests/components/Paper.test.tsx`
- Modify (prop fix): `frontend/tests/components/Paper.empty-hints.test.tsx:13`, `frontend/tests/components/CharRefSuggestion.test.tsx:48,79`
- Verify unaffected: `frontend/tests/pages/editor-paper.integration.test.tsx`

**Interfaces:**
- Produces: `PaperProps` no longer has `storyTitle` or `storyGenre`; `storyWordCount` is replaced by `initialWordCount?: number`. Retained: `draftLabel?`, `storyStatus?`, `chapterNumber?`, `chapterTitle?`, `chapterId?`, `initialBodyJson?`, `onUpdate?`, `onReady?`, `onChapterTitleChange?`, `storyId?`.
- Consumes (from EditorPage, unchanged): `viewedDraftMeta?.wordCount` (`EditorPage.tsx:238`) seeds `initialWordCount`.

- [ ] **Step 1: Rewrite the Paper test to the new hierarchy (red)**

Replace the whole file `frontend/tests/components/Paper.test.tsx` with:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSONContent, Editor as TiptapEditor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { Paper, type PaperProps } from '@/components/Paper';
import { createQueryClient } from '@/lib/queryClient';

async function renderAndGrab(
  props: Partial<PaperProps> = {},
): Promise<{ editor: TiptapEditor; unmount: () => void }> {
  let captured: TiptapEditor | null = null;
  const client = createQueryClient();
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <Paper
        {...props}
        onReady={(ed) => {
          captured = ed;
          props.onReady?.(ed);
        }}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(captured).not.toBeNull();
  });
  return { editor: captured!, unmount };
}

describe('Paper — header + status line', () => {
  it('renders the chapter title as the level-1 heading (editable input, no story title)', async () => {
    const { unmount } = await renderAndGrab({
      chapterId: 'ch-1',
      chapterTitle: 'A Quiet Beginning',
      chapterNumber: 3,
    });

    // Chapter title is the primary heading.
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    const input = screen.getByTestId('chapter-title-input') as HTMLInputElement;
    expect(input.value).toBe('A Quiet Beginning');
    // Primary heading scale, not the old italic 22px sub-heading.
    expect(input.className).toMatch(/text-\[28px\]/);
    expect(input.className).not.toMatch(/italic/);
    // Zero-padded § label retained.
    expect(screen.getByTestId('chapter-label')).toHaveTextContent('§ 03');
    unmount();
  });

  it('renders no heading and no story title when no chapter is selected', async () => {
    const { unmount } = await renderAndGrab({});
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByTestId('chapter-heading')).toBeNull();
    unmount();
  });

  it('status line shows draft label + word count and no genre', async () => {
    const { unmount } = await renderAndGrab({
      chapterId: 'ch-1',
      chapterTitle: 'Hollow Crown',
      draftLabel: 'Draft 2',
      initialWordCount: 12345,
    });
    const sub = screen.getByTestId('paper-sub');
    expect(sub).toHaveTextContent('Draft 2');
    expect(sub).toHaveTextContent('12,345 words');
    // Genre is gone: 'Fantasy' would have appeared here before.
    expect(sub).not.toHaveTextContent('Fantasy');
    expect(sub.className).toMatch(/uppercase/);
    expect(sub.className).toMatch(/font-mono/);
    unmount();
  });

  it('word count reflects the open draft and updates live as the body changes', async () => {
    const { editor, unmount } = await renderAndGrab({
      chapterId: 'ch-1',
      chapterTitle: 'Hollow Crown',
      draftLabel: 'Draft 1',
      initialWordCount: 0,
    });
    // Seeded from initialWordCount before any edit.
    expect(screen.getByTestId('paper-sub')).toHaveTextContent('0 words');
    act(() => {
      editor.commands.insertContent('Hello world today');
    });
    await waitFor(() => {
      expect(screen.getByTestId('paper-sub')).toHaveTextContent('3 words');
    });
    unmount();
  });

  it('omits the status chip when storyStatus is null', async () => {
    const { unmount } = await renderAndGrab({
      chapterId: 'ch-1',
      chapterTitle: 'Hollow Crown',
      draftLabel: 'Draft 1',
      initialWordCount: 0,
      storyStatus: null,
    });
    expect(screen.queryByTestId('paper-status-chip')).toBeNull();
    unmount();
  });

  it('omits the chapter heading entirely when no chapterTitle is provided', async () => {
    const { unmount } = await renderAndGrab({ chapterId: 'ch-1' });
    expect(screen.queryByTestId('chapter-heading')).toBeNull();
    unmount();
  });

  it('mounts the editor and accepts initialBodyJson', async () => {
    const initial: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one two three' }] }],
    };
    const { editor, unmount } = await renderAndGrab({ initialBodyJson: initial });
    expect(editor.getText()).toBe('one two three');
    expect(screen.getByRole('textbox', { name: /chapter body/i })).toBeInTheDocument();
    unmount();
  });

  it('fires onUpdate with bodyJson and wordCount when content changes', async () => {
    const onUpdate = vi.fn<(args: { bodyJson: JSONContent; wordCount: number }) => void>();
    const { editor, unmount } = await renderAndGrab({ onUpdate });
    act(() => {
      editor.commands.insertContent('Hello world');
    });
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });
    const lastCall = onUpdate.mock.calls.at(-1);
    expect(lastCall![0].wordCount).toBe(2);
    expect(lastCall![0].bodyJson).toMatchObject({ type: 'doc' });
    unmount();
  });

  it('fires onReady with the editor instance', async () => {
    const onReady = vi.fn<(editor: TiptapEditor | null) => void>();
    const { editor, unmount } = await renderAndGrab({ onReady });
    expect(onReady).toHaveBeenCalled();
    expect(onReady.mock.calls.at(-1)?.[0]).toBe(editor);
    unmount();
  });

  it('chapter title input commits the bound chapterId on blur, not the latest prop', async () => {
    const onChapterTitleChange = vi.fn();
    const { unmount } = await renderAndGrab({
      chapterId: 'A',
      chapterTitle: 'Chapter A title',
      onChapterTitleChange,
    });
    const input = screen.getByTestId('chapter-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed Chapter A' } });
    fireEvent.blur(input);
    expect(onChapterTitleChange).toHaveBeenCalledTimes(1);
    expect(onChapterTitleChange).toHaveBeenCalledWith('A', 'Renamed Chapter A');
    unmount();
  });

  it('blurring an empty chapter title silently reverts without firing onCommit', async () => {
    const onChapterTitleChange = vi.fn();
    const { unmount } = await renderAndGrab({
      chapterId: 'A',
      chapterTitle: 'Original',
      onChapterTitleChange,
    });
    const input = screen.getByTestId('chapter-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(onChapterTitleChange).not.toHaveBeenCalled();
    expect(input.value).toBe('Original');
    unmount();
  });

  it('Escape reverts the chapter title draft without committing', async () => {
    const onChapterTitleChange = vi.fn();
    const { unmount } = await renderAndGrab({
      chapterId: 'A',
      chapterTitle: 'Original',
      onChapterTitleChange,
    });
    const input = screen.getByTestId('chapter-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'half-typed' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Original');
    expect(onChapterTitleChange).not.toHaveBeenCalled();
    unmount();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm --prefix frontend run test -- Paper.test.tsx`
Expected: FAIL — type errors on `initialWordCount` / removed `storyTitle`, and heading/word-count assertions fail against the old markup.

- [ ] **Step 3: Update `PaperProps` and `SubRow` (Paper.tsx)**

In `frontend/src/components/Paper.tsx`, edit `PaperProps` (35-58): delete the `storyTitle: string;` line and the `storyGenre?: string | null;` line; replace `storyWordCount?: number;` with `initialWordCount?: number;`.

Edit `SubRowProps` (76-81) to drop `genre`:

```tsx
interface SubRowProps {
  draftLabel?: string | null;
  wordCount?: number;
  status?: string | null;
}
```

Edit `SubRow` (88-94) signature and remove the genre part:

```tsx
function SubRow({ draftLabel, wordCount, status }: SubRowProps): JSX.Element {
  const parts: SubRowPart[] = [];
  if (draftLabel) parts.push({ key: 'draft', node: <span>{draftLabel}</span> });
  if (typeof wordCount === 'number') {
    parts.push({ key: 'wc', node: <span>{wordCount.toLocaleString()} words</span> });
  }
  // ...unchanged return...
```

- [ ] **Step 4: Restyle `ChapterTitleInput` to the primary-heading scale (Paper.tsx:185)**

Replace the input `className` (185) with:

```tsx
      className="w-full bg-transparent font-serif text-[28px] font-semibold leading-tight tracking-[-0.01em] text-ink outline-none focus:bg-[var(--accent-soft)]/30 rounded-sm px-1 -mx-1"
```

(was `flex-1 … text-[22px] italic …` — `flex-1`→`w-full` since the parent `<h1>` carries the flex sizing; drop `italic`; add the 28px/semibold/leading/tracking title scale.)

- [ ] **Step 5: Add the live word-count state and update the render tree (Paper.tsx)**

In the `Paper` function signature (190-204), remove `storyTitle`, `storyGenre`, `storyWordCount` from the destructure and add `initialWordCount`. Immediately inside the function body (before `useEditor`), add:

```tsx
  // Live per-draft word count for the status line. Seeded from the open
  // draft's server-authoritative count so it's correct before the first
  // keystroke; Paper is keyed on viewedDraftId upstream, so a draft switch
  // remounts and re-seeds — no effect needed.
  const [liveWordCount, setLiveWordCount] = useState<number>(initialWordCount ?? 0);
```

Change the editor `onUpdate` (257-263) to always update the live count:

```tsx
    onUpdate({ editor: ed }) {
      const json = ed.getJSON();
      const wordCount = countWords(ed.getText());
      setLiveWordCount(wordCount);
      onUpdateRef.current?.({ bodyJson: json, wordCount });
    },
```

Replace the render tree (302-343) so the chapter heading is the primary `<h1>` at the top, the sub-row follows, and the story `<h1>` is gone:

```tsx
  return (
    <article className="paper mx-auto w-full max-w-[1080px] px-20 pt-12 pb-60">
      {chapterTitle !== null && chapterTitle !== undefined && chapterId ? (
        <header data-testid="chapter-heading" className="flex items-baseline gap-3">
          <h1 className="paper-title flex-1 min-w-0 m-0">
            <ChapterTitleInput
              chapterId={chapterId}
              value={chapterTitle}
              onCommit={onChapterTitleChange}
            />
          </h1>
          {chapterLabel ? (
            <span
              data-testid="chapter-label"
              className="font-sans text-[11px] uppercase tracking-[.06em] text-ink-4"
            >
              {chapterLabel}
            </span>
          ) : null}
        </header>
      ) : null}

      <SubRow draftLabel={draftLabel} wordCount={liveWordCount} status={storyStatus} />

      <div className="paper-prose mt-6">
        <EditorContent editor={editor} />
      </div>
      {isEmpty ? <EditorEmptyHints /> : null}
      <CharRefMenu />
    </article>
  );
```

- [ ] **Step 6: Update EditorPage's Paper wiring (EditorPage.tsx:811-815)**

Remove the `storyTitle={story.title}` (812) and `storyGenre={story.genre}` (813) props, and replace `storyWordCount={totalWordCount}` (815) with:

```tsx
                    initialWordCount={viewedDraftMeta?.wordCount ?? 0}
```

Leave `draftLabel={…}` (814) and everything else unchanged. (`totalWordCount` at 526-528 stays — the Sidebar at 716 still uses it.)

- [ ] **Step 7: Fix the two prop-only test call sites**

`frontend/tests/components/Paper.empty-hints.test.tsx:13` — remove the `storyTitle="The Long Dark"` prop:

```tsx
      <Paper initialBodyJson={initialBodyJson as never} />
```

`frontend/tests/components/CharRefSuggestion.test.tsx:48,79` — remove the `storyTitle="Test"` line at both call sites (leave the surrounding props).

- [ ] **Step 8: Run the affected tests to confirm green**

Run: `npm --prefix frontend run test -- Paper.test.tsx Paper.empty-hints.test.tsx CharRefSuggestion.test.tsx editor-paper.integration.test.tsx`
Expected: PASS. (The integration test asserts `chapter-heading` presence, which still exists, and does not assert story-title/genre display; if any assertion there references the old story `<h1>` or genre text, update it to the chapter-title heading.)

Then, to honor the spec's requested end-to-end coverage (`spec.md` Testing), add these two assertions in the block that already awaits `chapter-heading` (~`editor-paper.integration.test.tsx:223`) — scoped to `paper-sub` so they can't collide with genre shown elsewhere in the shell:

```tsx
    // story-editor-322: chapter title is the editor's primary heading, and
    // genre no longer appears in the status line.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('paper-sub')).not.toHaveTextContent('Sci-Fi');
```

Re-run the integration test; Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `npm --prefix frontend run typecheck`
Expected: PASS (no dangling `storyTitle`/`storyGenre`/`storyWordCount` references anywhere).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/Paper.tsx frontend/src/pages/EditorPage.tsx frontend/tests/components/Paper.test.tsx frontend/tests/components/Paper.empty-hints.test.tsx frontend/tests/components/CharRefSuggestion.test.tsx frontend/tests/pages/editor-paper.integration.test.tsx
git commit -m "[story-editor-322] Paper: chapter-title header, live per-draft word count, drop genre"
```

---

### Task 2: Paper Storybook story (spec-required deliverable)

**Files:**
- Create: `frontend/src/components/Paper.stories.tsx`

**Interfaces:**
- Consumes: `Paper` / `PaperProps` from Task 1 (chapter-title header, `initialWordCount`, `draftLabel`, `chapterNumber`, `chapterTitle`).

- [ ] **Step 1: Write the story file**

`Paper` uses `useCharactersQuery` and `useUserSettingsQuery`, so it needs a `QueryClientProvider`. Mirror `DraftList.stories.tsx`'s seeded-client pattern (an empty client is fine — the queries degrade to empty/defaults). Create `frontend/src/components/Paper.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSONContent } from '@tiptap/core';
import { Paper } from '@/components/Paper';

// Empty client — Paper's character/settings queries degrade to defaults with
// no network in Storybook.
function client(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

const BODY: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'The tower had stood empty for a hundred years before the light returned to its highest window.',
        },
      ],
    },
  ],
};

const meta: Meta<typeof Paper> = {
  title: 'Components/Paper',
  component: Paper,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client()}>
        <div className="min-h-screen bg-bg">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof Paper>;

export const TitledChapter: Story = {
  args: {
    chapterId: 'ch-1',
    chapterTitle: 'The Reckoning',
    chapterNumber: 3,
    draftLabel: 'Draft A',
    initialWordCount: 1204,
    initialBodyJson: BODY,
    storyId: 'story-1',
  },
};

export const UntitledChapter: Story = {
  args: {
    chapterId: 'ch-2',
    chapterTitle: '',
    chapterNumber: 1,
    draftLabel: 'Draft 1',
    initialWordCount: 0,
    storyId: 'story-1',
  },
};

export const NoChapterSelected: Story = {
  args: {
    chapterId: null,
    chapterTitle: null,
    initialWordCount: 0,
    storyId: 'story-1',
  },
};
```

- [ ] **Step 2: Verify the story typechecks and builds**

Run: `npm --prefix frontend run typecheck`
Expected: PASS.
Run: `npm --prefix frontend run build-storybook 2>&1 | tail -5` (if a `build-storybook` script exists; otherwise skip — the typecheck above is the gate).
Expected: PASS / builds without error.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Paper.stories.tsx
git commit -m "[story-editor-322] Storybook: Paper header/status-line states"
```

---

### Task 3: Uniform chapter row skeleton (item 4)

**Files:**
- Modify: `frontend/src/components/ChapterList.tsx` (`ChapterRow` render 141-248: caret 172-188, action cluster 224-245)
- Test (update): `frontend/tests/components/ChapterList.delete.test.tsx:61-74`
- Modify: `frontend/src/components/ChapterList.stories.tsx`
- Verify unaffected: `frontend/tests/components/ChapterList.drafts.test.tsx`, `frontend/tests/components/ChapterList.test.tsx`

**Interfaces:**
- Consumes: `revealOnRowHover` (`primitives.tsx:692`), `IconButton`, `CloseIcon` (already imported in ChapterList.tsx).
- Produces: every ChapterRow renders a fixed caret slot and an always-mounted action cluster; the delete `×` (`data-testid=chapter-row-<id>-delete`) is always in the DOM, opacity-revealed on hover OR when the row is active.

- [ ] **Step 1: Update the delete test to the always-mounted skeleton (red)**

In `frontend/tests/components/ChapterList.delete.test.tsx`, replace the `renders × only on the active row` test (61-74) with:

```tsx
  it('renders × on every row (always mounted, opacity-gated); clickable on the active row', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        chapters: [
          makeChapterMeta({ id: 'c1', orderIndex: 0 }),
          makeChapterMeta({ id: 'c2', orderIndex: 1 }),
        ],
      }),
    );
    renderList({ activeChapterId: 'c2' });
    await screen.findByTestId('chapter-row-c2');
    // Delete button is now present in the DOM for BOTH rows (reveal is opacity,
    // not mount) so selecting a chapter no longer reflows the row.
    expect(screen.getByTestId('chapter-row-c1-delete')).toBeInTheDocument();
    expect(screen.getByTestId('chapter-row-c2-delete')).toBeInTheDocument();
  });
```

(The other tests in this file drive delete on the active row `c1` and still pass unchanged.)

- [ ] **Step 2: Run to confirm it fails**

Run: `npm --prefix frontend run test -- ChapterList.delete.test.tsx`
Expected: FAIL — `chapter-row-c1-delete` is currently absent on the non-active row.

- [ ] **Step 3: Reserve a fixed caret slot (ChapterList.tsx:172-188)**

Replace the `chapter.draftCount > 1 ? (<button …caret…/>) : null` block with an always-present slot — the caret button when expandable, else a same-width invisible spacer:

```tsx
        {chapter.draftCount > 1 ? (
          <button
            type="button"
            aria-label="Show drafts"
            aria-expanded={expanded}
            aria-controls={`draft-list-${chapter.id}`}
            data-testid={`chapter-row-${chapter.id}-caret`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpanded();
            }}
            className="w-4 flex-shrink-0 text-ink-4 hover:text-ink-2 transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
          >
            <span aria-hidden="true">▸</span>
          </button>
        ) : (
          <span aria-hidden="true" className="w-4 flex-shrink-0" />
        )}
```

(The spacer is a non-interactive `<span>`, so `queryByRole('button', { name: 'Show drafts' })` stays null for single-draft chapters — preserving `ChapterList.drafts.test.tsx`.)

- [ ] **Step 4: Always-mount the action cluster with hover/active reveal (ChapterList.tsx:224-245)**

Replace the `showNewDraftAffordance ? (…＋…) : null` and `active ? (…×…) : null` blocks (224-245) with a single always-mounted cluster. The `data-active` reveal keeps `×` visible on the selected row (no reachability regression); `revealOnRowHover` adds the hover affordance:

```tsx
            <span
              className={[
                'flex items-center gap-2 flex-shrink-0',
                // Order-INDEPENDENT reveal: on the active row use opacity-100
                // directly (omit revealOnRowHover's opacity-0 entirely) so
                // visibility never depends on Tailwind's compiled class order;
                // inactive rows reveal on hover/focus via revealOnRowHover.
                active ? 'opacity-100' : revealOnRowHover,
              ].join(' ')}
            >
              {showNewDraftAffordance ? (
                <IconButton
                  ariaLabel="New draft"
                  onClick={() => {
                    onRequestNewDraft(chapter.id);
                  }}
                  testId={`chapter-row-${chapter.id}-new-draft`}
                  className="flex-shrink-0"
                >
                  <span aria-hidden="true">＋</span>
                </IconButton>
              ) : null}
              <IconButton
                ariaLabel={`Delete ${chapterDisplayTitle(chapter)}`}
                onClick={confirm.ask}
                testId={`chapter-row-${chapter.id}-delete`}
                className="flex-shrink-0"
              >
                <CloseIcon />
              </IconButton>
            </span>
```

(On the active row the ternary emits `opacity-100` and never `opacity-0`, so the delete button is unconditionally visible regardless of Tailwind's compiled class order; inactive rows get `revealOnRowHover` (hover/focus reveal). The whole cluster is always mounted and in layout, so nothing reflows on hover or select.)

- [ ] **Step 5: Run the ChapterList tests to confirm green**

Run: `npm --prefix frontend run test -- ChapterList.delete.test.tsx ChapterList.drafts.test.tsx ChapterList.test.tsx`
Expected: PASS. (`ChapterList.test.tsx:396` still clicks delete on the active row; `ChapterList.drafts.test.tsx` caret assertions still hold since the spacer is not a button.)

- [ ] **Step 6: Add a uniform-rows Storybook story**

`ChapterList.stories.tsx` seeds via an inline `sampleChapters: ChapterMeta[]` and a `withClient(seed)` decorator (`ChapterList.stories.tsx:91`) that supplies the `QueryClientProvider` — there is **no** `makeChapterMeta` helper and the `meta` has no provider, so a story with `args` only would throw. Add a seed mixing a multi-draft chapter (caret) with active + inactive single-draft chapters (spacer), reusing `sampleChapters`, and append the story with the required `withClient(...)` decorator. Add near the other story exports:

```tsx
// Uniform rows: a multi-draft chapter (caret) alongside active + inactive
// single-draft chapters (invisible caret spacer) — all rows the same width,
// no reflow on hover/select. c1 is multi-draft but not active, so it stays
// collapsed (no DraftList mount → no draftsQueryKey seed needed).
const uniformRowChapters: ChapterMeta[] = [
  { ...sampleChapters[0], draftCount: 2 },
  sampleChapters[1],
  sampleChapters[2],
];

export const UniformRows: Story = {
  args: { activeChapterId: 'c2' },
  decorators: [withClient(uniformRowChapters)],
};
```

(`activeChapterId: 'c2'` selects an inactive-caret single-draft row so the active-row delete reveal and the caret spacer are both visible in one frame. `withClient` seeds only `chaptersQueryKey`; the collapsed multi-draft `c1` needs no draft seed.)

- [ ] **Step 7: Typecheck + commit**

Run: `npm --prefix frontend run typecheck`
Expected: PASS.

```bash
git add frontend/src/components/ChapterList.tsx frontend/tests/components/ChapterList.delete.test.tsx frontend/src/components/ChapterList.stories.tsx
git commit -m "[story-editor-322] ChapterList: uniform row skeleton (no reflow on hover/select)"
```

---

### Task 4: Full verify

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend gate**

Run: `npm --prefix frontend run typecheck && npm --prefix frontend run test && npm --prefix frontend run lint:design`
Expected: all PASS. If `lint:design` flags a raw color from the new styles, replace it with the corresponding token and re-run.

- [ ] **Step 2: Commit any lint fixups**

```bash
git add -A
git commit -m "[story-editor-322] editor polish: design-lint fixups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Item 1 (chapter-title header, story title removed, `§` label kept, H1 wrapper) → Task 1 Steps 4–5, test Step 1.
- Item 2 (live per-draft word count, `initialWordCount` seed, remount reseed) → Task 1 Steps 5–6, test Step 1 (live-update test).
- Item 3 (genre removed) → Task 1 Step 3, test Step 1 (no-genre assertion).
- Item 4 (uniform row skeleton, hover-OR-active reveal, caret spacer) → Task 3 Steps 3–4, test Steps 1–5.
- Storybook (required) → Task 2 (Paper) + Task 3 Step 6 (ChapterList).
- Testing/verify → Task 4.

**Placeholder scan:** all steps carry concrete code or exact commands. The only intentional latitude is Task 3 Step 6 (ChapterList story) and Task 1 Step 8 (integration test), phrased as "match the file's existing shape / update only if it references removed elements" because those files' exact current contents aren't reproduced here — the implementer follows the established pattern in-file.

**Type consistency:** `initialWordCount?: number` is defined in `PaperProps` (Task 1) and consumed in EditorPage (Task 1 Step 6) and the Paper story (Task 2) and tests (Task 1 Step 1) with the same name/type. `liveWordCount`/`setLiveWordCount` are internal to Paper. `revealOnRowHover`, `IconButton`, `CloseIcon` are existing imports. No new cross-task signatures.
