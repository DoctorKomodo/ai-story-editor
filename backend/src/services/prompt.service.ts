// backend/src/services/prompt.service.ts
// Pure, no IO, no async. `stream` and `model` are injected by the route
// layer so this module stays unit-testable without HTTP or Venice deps.

import type { ChapterSummary, CharacterPromptInput } from 'story-editor-shared';

export class PromptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptValidationError';
  }
}

export type PromptAction =
  | 'continue'
  | 'rephrase'
  | 'expand'
  | 'summarise'
  | 'rewrite'
  | 'describe'
  | 'scene'
  | 'ask';

// [X29] Keys of the user-overridable prompt slice. `rewrite` covers both
// 'rephrase' and 'rewrite' actions (collapsed at the override layer; the
// in-builder strings for each surface stay distinct via DEFAULT_PROMPTS).
export type UserPromptKey =
  | 'system'
  | 'continue'
  | 'rewrite'
  | 'expand'
  | 'summarise'
  | 'summariseChapter'
  | 'describe'
  | 'scene'
  | 'ask';

export type UserPrompts = Partial<Record<UserPromptKey, string | null>>;

export interface BuildPromptInput {
  action: PromptAction;
  selectedText: string;
  chapterContent: string;
  characters: CharacterPromptInput[];
  worldNotes: string | null;
  modelContextLength: number;
  /** Per-model output cap from Venice's /v1/models. Required. */
  modelMaxCompletionTokens: number;
  /**
   * Budget cap for the prompt builder's context calculation. Post-X28 the
   * AI/chat routes always pass `Number.POSITIVE_INFINITY` here so the
   * prompt-side budget is governed solely by `modelMaxCompletionTokens`
   * (the model's own cap from Venice). The user's per-model `maxTokens`
   * override goes directly to Venice via `resolveTextGenParams`'s
   * `max_completion_tokens` and does not narrow the prompt's chapter-text
   * budget — keeping a small "fast response" override from over-trimming
   * the input context window.
   */
  userMaxCompletionTokens: number;
  /** [V4] — default true when omitted */
  includeVeniceSystemPrompt?: boolean;
  /** [X29] User-level prompt overrides. Per key: non-empty trimmed string wins; null / undefined / whitespace falls back to DEFAULT_PROMPTS[key]. */
  userPrompts?: UserPrompts;
  /** Required when action === 'scene' or 'ask'; optional otherwise */
  freeformInstruction?: string;
  /** Decrypted summaries for chapters preceding the current one, ordered by orderIndex ascending. */
  previousChapters?: Array<{ orderIndex: number; title: string; summary: ChapterSummary }>;
}

export interface BuiltPrompt {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  venice_parameters: {
    include_venice_system_prompt: boolean;
  };
  max_completion_tokens: number;
}

// ─── Exported constants ───────────────────────────────────────────────────────

// Persona only — universal across every Venice call (prose + structured).
// Output-shape rules moved to PROSE_OUTPUT_RULES below so structured-output
// callers (e.g. chapter summarise → json_schema) can adopt the persona
// without inheriting "no quotation marks" (which would break JSON output).
export const DEFAULT_SYSTEM_PROMPT =
  'You are an expert creative-writing assistant. ' +
  'Help the author continue, refine, and develop their story with vivid prose ' +
  'that matches their established voice and tone.';

// Prefixed onto every prose action's task template (the body inside the
// <task> block). Each prose action's full default is
// `${PROSE_OUTPUT_RULES} ${action-specific body}`. Structured-output
// actions (those returning JSON via response_format) must NOT include
// this — "no quotation marks" would conflict with valid JSON output.
export const PROSE_OUTPUT_RULES =
  'Return only the requested content — no preamble, no meta-commentary, ' +
  'no quotation marks around the output, no XML tags, and no section labels.';

// [X29] Single source of truth for default templates — exposed via
// GET /api/ai/default-prompts so the frontend renders the same strings
// it will fall back to. Frontend MUST NOT duplicate these.
export const DEFAULT_PROMPTS = {
  system: DEFAULT_SYSTEM_PROMPT,
  continue:
    `${PROSE_OUTPUT_RULES} ` +
    'continue the story from where the selection ends, matching the established voice. Aim for roughly 80–150 words.',
  rewrite:
    `${PROSE_OUTPUT_RULES} ` +
    'rewrite the selection with different phrasing while preserving meaning and voice. Return a single alternative version.',
  expand:
    `${PROSE_OUTPUT_RULES} ` +
    'expand the selection with more detail, description, and depth. Keep the same POV, tense, and voice.',
  summarise:
    `${PROSE_OUTPUT_RULES} ` +
    'summarise the selection to its essential points. Use 1–3 sentences.',
  describe:
    `${PROSE_OUTPUT_RULES} ` +
    "describe the subject of the selection with vivid sensory, physical, and emotional detail. Maintain the story's POV and tense.",
  scene:
    `${PROSE_OUTPUT_RULES} ` +
    'write a passage of prose that depicts the scene the user describes. Render the action and dialogue directly — do not summarise. Match the established voice, POV, and tense from the chapter so far. Aim for roughly 100–200 words unless the user specifies otherwise.',
  ask:
    `${PROSE_OUTPUT_RULES} ` +
    "answer the user's question about the story. Use the chapter and character context to inform your answer.",
  summariseChapter:
    'You produce structured per-chapter summaries for a long-form fiction project. ' +
    'Read the chapter and emit a JSON object matching the provided schema exactly. ' +
    'Be terse and concrete; the consumer is another LLM that will use your output as context when writing the next chapter.',
} as const satisfies Record<UserPromptKey, string>;

// Reserved tokens between the response budget and the prompt budget. Covers
// SSE/tokenizer drift and Venice-side overhead so a request sized at exactly
// (context - response) doesn't fail the upstream "prompt + completion >
// max_tokens" check intermittently.
export const SAFETY_MARGIN_TOKENS = 512;

// ─── Token estimation ─────────────────────────────────────────────────────────

export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

// ─── XML escape helpers (h0z) ────────────────────────────────────────────────
// Used wherever decrypted user content is interpolated into XML wrappers in
// the system-message content. Escape semantics: input is plaintext (escape is
// non-idempotent — a literal "&amp;" in user input renders as "&amp;amp;").

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Per-character renderer ───────────────────────────────────────────────────

function renderCharacterTag(c: CharacterPromptInput): string {
  if (!c.name) return '';
  const attrs = [
    ` name="${escapeXmlAttr(c.name)}"`,
    c.role ? ` role="${escapeXmlAttr(c.role)}"` : '',
    c.age ? ` age="${escapeXmlAttr(c.age)}"` : '',
  ].join('');

  const proseFields = [
    ['appearance', c.appearance],
    ['personality', c.personality],
    ['voice', c.voice],
    ['backstory', c.backstory],
    ['arc', c.arc],
    ['relationships', c.relationships],
  ] as const;

  const children = proseFields
    .filter(([, v]) => v != null && v.trim().length > 0)
    .map(([tag, v]) => `  <${tag}>${escapeXmlText(v!.trim())}</${tag}>`)
    .join('\n');

  if (children.length === 0) return `<character${attrs} />`;
  return `<character${attrs}>\n${children}\n</character>`;
}

// ─── Previous-chapters block renderer ────────────────────────────────────────

function renderPreviousChaptersBlock(
  entries: Array<{ orderIndex: number; title: string; summary: ChapterSummary }>,
  truncatedCount: number,
): string {
  if (entries.length === 0) return '';
  const opener =
    truncatedCount > 0
      ? `<previous_chapters truncated_count="${truncatedCount}">`
      : '<previous_chapters>';
  const inner = entries
    .map(
      (e) =>
        `<chapter index="${e.orderIndex + 1}" title="${escapeXmlAttr(e.title)}">\n` +
        `  <events>${escapeXmlText(e.summary.events)}</events>\n` +
        `  <state_at_end>${escapeXmlText(e.summary.stateAtEnd)}</state_at_end>\n` +
        `  <open_threads>${escapeXmlText(e.summary.openThreads)}</open_threads>\n` +
        `</chapter>`,
    )
    .join('\n');
  return `${opener}\n${inner}\n</previous_chapters>`;
}

// ─── Resolution helper ────────────────────────────────────────────────────────

export function resolvePrompt(userPrompts: UserPrompts | undefined, key: UserPromptKey): string {
  const v = userPrompts?.[key];
  if (typeof v === 'string' && v.trim().length > 0) return v;
  return DEFAULT_PROMPTS[key];
}

// ─── User payload (per-action) ────────────────────────────────────────────────
//
// k1r: Returns the user-message body. The system message carries chapter /
// characters / world-notes / task-template; this function only emits what
// the user contributed this turn. See
// docs/superpowers/specs/2026-05-10-k1r-prompt-building-unification-design.md.

export function buildUserPayload(input: BuildPromptInput): string {
  const sel = input.selectedText.length > 0 ? `Selection: «${input.selectedText}»` : '';

  switch (input.action) {
    case 'scene': {
      if (!input.freeformInstruction) {
        throw new PromptValidationError('freeformInstruction is required for action "scene"');
      }
      return input.freeformInstruction;
    }
    case 'ask': {
      if (!input.freeformInstruction) {
        throw new PromptValidationError('freeformInstruction is required for action "ask"');
      }
      const attached =
        input.selectedText.length > 0 ? `\n\nAttached selection: «${input.selectedText}»` : '';
      return `${input.freeformInstruction}${attached}`;
    }
    case 'continue':
      return sel.length > 0 ? sel : 'Continue.';
    case 'rephrase':
    case 'rewrite':
      return sel.length > 0 ? sel : 'Rewrite.';
    case 'expand':
      return sel.length > 0 ? sel : 'Expand.';
    case 'summarise':
      return sel.length > 0 ? sel : 'Summarise.';
    case 'describe':
      return sel.length > 0 ? sel : 'Describe.';
  }
}

// ─── Per-action task template lookup ──────────────────────────────────────────

function taskTemplateFor(action: PromptAction, userPrompts: UserPrompts | undefined): string {
  // 'rephrase' shares the 'rewrite' override key (collapsed under [X29]).
  const key: UserPromptKey = action === 'rephrase' ? 'rewrite' : action;
  return resolvePrompt(userPrompts, key);
}

// ─── Core builder ─────────────────────────────────────────────────────────────

export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const responseTokens = Math.min(input.modelMaxCompletionTokens, input.userMaxCompletionTokens);
  const includeVeniceSystemPrompt = input.includeVeniceSystemPrompt ?? true;

  const promptBudgetTokens = Math.max(
    0,
    input.modelContextLength - responseTokens - SAFETY_MARGIN_TOKENS,
  );

  const systemContent = resolvePrompt(input.userPrompts, 'system');

  const worldNotesBlock = (() => {
    const trimmed = input.worldNotes ? input.worldNotes.trimEnd() : '';
    return trimmed.length > 0 ? `<world_notes>\n${escapeXmlText(trimmed)}\n</world_notes>` : '';
  })();

  const charactersBlock =
    input.characters.length > 0
      ? `<characters>\n${input.characters
          .map(renderCharacterTag)
          .filter((s) => s.length > 0)
          .join('\n')}\n</characters>`
      : '';

  const taskTemplate = taskTemplateFor(input.action, input.userPrompts);
  const taskTrimmed = taskTemplate.trimEnd();
  const taskBlock = taskTrimmed.length > 0 ? `<task>\n${escapeXmlText(taskTrimmed)}\n</task>` : '';
  const userPayload = buildUserPayload(input);

  const fixedTokens =
    estimateTokens(systemContent) +
    estimateTokens(worldNotesBlock) +
    estimateTokens(charactersBlock) +
    estimateTokens(taskBlock) +
    estimateTokens(userPayload);

  const entries = (input.previousChapters ?? []).slice();
  let truncatedCount = 0;
  let previousChaptersBlock = renderPreviousChaptersBlock(entries, truncatedCount);
  let chapterBudgetTokens =
    promptBudgetTokens - fixedTokens - estimateTokens(previousChaptersBlock);
  while (chapterBudgetTokens <= 0 && entries.length > 0) {
    entries.shift();
    truncatedCount++;
    previousChaptersBlock = renderPreviousChaptersBlock(entries, truncatedCount);
    chapterBudgetTokens = promptBudgetTokens - fixedTokens - estimateTokens(previousChaptersBlock);
  }

  let chapterText = input.chapterContent;
  if (chapterBudgetTokens <= 0) {
    chapterText = '';
  } else {
    const maxChapterChars = chapterBudgetTokens * 4;
    if (chapterText.length > maxChapterChars) {
      chapterText = chapterText.slice(chapterText.length - maxChapterChars);
    }
  }

  const chapterTrimmed = chapterText.trimEnd();
  const chapterBlock =
    chapterTrimmed.length > 0
      ? `<chapter_so_far>\n${escapeXmlText(chapterTrimmed)}\n</chapter_so_far>`
      : '';

  const systemParts = [
    systemContent,
    worldNotesBlock,
    charactersBlock,
    previousChaptersBlock,
    chapterBlock,
    taskBlock,
  ].filter((p) => p.length > 0);

  return {
    messages: [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: userPayload },
    ],
    venice_parameters: { include_venice_system_prompt: includeVeniceSystemPrompt },
    max_completion_tokens: responseTokens,
  };
}
