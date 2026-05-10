// backend/src/services/prompt.service.ts
// Pure, no IO, no async. `stream` and `model` are injected by the route
// layer so this module stays unit-testable without HTTP or Venice deps.

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

export interface CharacterContext {
  name: string;
  role?: string | null;
  keyTraits?: string | null;
}

// [h0z] Permissive shape that matches the decrypted character row returned by
// the character repo. Kept loose (`unknown` per field) so the pure prompt
// service stays decoupled from the repo's narrative-character type.
export interface CharacterRecord {
  name?: unknown;
  role?: unknown;
  personality?: unknown;
  arc?: unknown;
  appearance?: unknown;
  voice?: unknown;
}

// [h0z] Pure projection of a decrypted character row into the trimmed shape
// the prompt builder consumes. Previously inlined in ai.routes.ts and
// chat.routes.ts (byte-for-byte duplicate, modulo one stray comment).
// The 120-char cap from the inlined version is removed by design.
export function toCharacterContext(c: CharacterRecord): CharacterContext {
  const name = typeof c.name === 'string' ? c.name : '';
  const role = typeof c.role === 'string' ? c.role : null;
  const traits: string[] = [];
  for (const f of ['personality', 'arc', 'appearance', 'voice'] as const) {
    const v = c[f];
    if (typeof v === 'string' && v.trim().length > 0) traits.push(v.trim());
  }
  return { name, role, keyTraits: traits.join('; ') || null };
}

// [X29] Keys of the user-overridable prompt slice. `rewrite` covers both
// 'rephrase' and 'rewrite' actions (collapsed at the override layer; the
// in-builder strings for each surface stay distinct via DEFAULT_PROMPTS).
export type UserPromptKey =
  | 'system'
  | 'continue'
  | 'rewrite'
  | 'expand'
  | 'summarise'
  | 'describe'
  | 'scene'
  | 'ask';

export type UserPrompts = Partial<Record<UserPromptKey, string | null>>;

export interface BuildPromptInput {
  action: PromptAction;
  selectedText: string;
  chapterContent: string;
  characters: CharacterContext[];
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
}

export interface BuiltPrompt {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  venice_parameters: {
    include_venice_system_prompt: boolean;
  };
  max_completion_tokens: number;
}

// ─── Exported constants ───────────────────────────────────────────────────────

export const DEFAULT_SYSTEM_PROMPT =
  'You are an expert creative-writing assistant. ' +
  'Help the author continue, refine, and develop their story with vivid prose that matches their established voice and tone. ' +
  'Return only the requested content — no preamble, no meta-commentary, no quotation marks around the output.';

// [X29] Single source of truth for default templates — exposed via
// GET /api/ai/default-prompts so the frontend renders the same strings
// it will fall back to. Frontend MUST NOT duplicate these.
export const DEFAULT_PROMPTS = {
  system: DEFAULT_SYSTEM_PROMPT,
  continue:
    'Task: continue the story from where the selection ends, matching the established voice. Aim for roughly 80–150 words.',
  rewrite:
    'Task: rewrite the selection with different phrasing while preserving meaning and voice. Return a single alternative version.',
  expand:
    'Task: expand the selection with more detail, description, and depth. Keep the same POV, tense, and voice.',
  summarise: 'Task: summarise the selection to its essential points. Use 1–3 sentences.',
  describe:
    "Task: describe the subject of the selection with vivid sensory, physical, and emotional detail. Maintain the story's POV and tense.",
  scene:
    'Task: write a passage of prose that depicts the scene the user describes. Render the action and dialogue directly — do not summarise. Match the established voice, POV, and tense from the chapter so far. Aim for roughly 100–200 words unless the user specifies otherwise.',
  ask: "Task: answer the user's question about the story. Use the chapter and character context to inform your answer.",
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

// ─── Per-character renderer (h0z) ────────────────────────────────────────────

function renderCharacterTag(c: CharacterContext): string {
  if (!c.name) return ''; // skip malformed empty-name entries entirely
  const nameAttr = ` name="${escapeXmlAttr(c.name)}"`;
  const roleAttr = c.role ? ` role="${escapeXmlAttr(c.role)}"` : '';
  if (!c.keyTraits) return `<character${nameAttr}${roleAttr} />`;
  return `<character${nameAttr}${roleAttr}>${escapeXmlText(c.keyTraits)}</character>`;
}

// ─── Resolution helper ────────────────────────────────────────────────────────

function resolvePrompt(userPrompts: UserPrompts | undefined, key: UserPromptKey): string {
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

  const worldNotesBlock =
    input.worldNotes && input.worldNotes.length > 0 ? `World notes:\n${input.worldNotes}` : '';

  const charactersBlock =
    input.characters.length > 0
      ? `<characters>\n${input.characters
          .map(renderCharacterTag)
          .filter((s) => s.length > 0)
          .join('\n')}\n</characters>`
      : '';

  const taskTemplate = taskTemplateFor(input.action, input.userPrompts);
  const userPayload = buildUserPayload(input);

  const fixedTokens =
    estimateTokens(systemContent) +
    estimateTokens(worldNotesBlock) +
    estimateTokens(charactersBlock) +
    estimateTokens(taskTemplate) +
    estimateTokens(userPayload);

  const chapterBudgetTokens = promptBudgetTokens - fixedTokens;

  let chapterText = input.chapterContent;
  if (chapterBudgetTokens <= 0) {
    chapterText = '';
  } else {
    const maxChapterChars = chapterBudgetTokens * 4;
    if (chapterText.length > maxChapterChars) {
      chapterText = chapterText.slice(chapterText.length - maxChapterChars);
    }
  }

  const chapterBlock = chapterText.length > 0 ? `Chapter so far:\n${chapterText}` : '';

  const systemParts = [
    systemContent,
    worldNotesBlock,
    charactersBlock,
    chapterBlock,
    taskTemplate,
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
