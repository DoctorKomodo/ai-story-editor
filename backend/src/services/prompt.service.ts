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
  | 'freeform'
  | 'rewrite'
  | 'describe'
  | 'ask';

export interface CharacterContext {
  name: string;
  role?: string | null;
  keyTraits?: string | null;
}

// [X29] Keys of the user-overridable prompt slice. `rewrite` covers both
// 'rephrase' and 'rewrite' actions (collapsed at the override layer; the
// in-builder strings for each surface stay distinct via DEFAULT_PROMPTS).
export type UserPromptKey = 'system' | 'continue' | 'rewrite' | 'expand' | 'summarise' | 'describe';

export type UserPrompts = Partial<Record<UserPromptKey, string | null>>;

export interface BuildPromptInput {
  action: PromptAction;
  selectedText: string;
  chapterContent: string;
  characters: CharacterContext[];
  worldNotes: string | null;
  modelContextLength: number;
  /** [V4] — default true when omitted */
  includeVeniceSystemPrompt?: boolean;
  /** [X29] User-level prompt overrides. Per key: non-empty trimmed string wins; null / undefined / whitespace falls back to DEFAULT_PROMPTS[key]. */
  userPrompts?: UserPrompts;
  /** Required when action === 'freeform' or 'ask'; optional otherwise */
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
} as const satisfies Record<UserPromptKey, string>;

// ─── Token estimation ─────────────────────────────────────────────────────────

export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

// ─── Ask-action user content renderer ────────────────────────────────────────

export function renderAskUserContent({
  freeformInstruction,
  selectionText,
}: {
  freeformInstruction: string;
  selectionText?: string | null;
}): string {
  const attached = selectionText ? `\n\nAttached selection: «${selectionText}»` : '';
  return `User question: ${freeformInstruction}${attached}`;
}

// ─── Resolution helper ────────────────────────────────────────────────────────

function resolvePrompt(userPrompts: UserPrompts | undefined, key: UserPromptKey): string {
  const v = userPrompts?.[key];
  if (typeof v === 'string' && v.trim().length > 0) return v;
  return DEFAULT_PROMPTS[key];
}

// ─── Action task block ────────────────────────────────────────────────────────

function buildTaskBlock(input: BuildPromptInput): string {
  const sel = input.selectedText ? `\n\nSelection: «${input.selectedText}»` : '';
  switch (input.action) {
    case 'continue':
      return `${resolvePrompt(input.userPrompts, 'continue')}${sel}`;
    case 'rephrase':
    case 'rewrite':
      // Both surfaces collapse onto the single 'rewrite' override key.
      return `${resolvePrompt(input.userPrompts, 'rewrite')}${sel}`;
    case 'expand':
      return `${resolvePrompt(input.userPrompts, 'expand')}${sel}`;
    case 'summarise':
      return `${resolvePrompt(input.userPrompts, 'summarise')}${sel}`;
    case 'describe':
      return `${resolvePrompt(input.userPrompts, 'describe')}${sel}`;
    case 'freeform': {
      const instruction = input.freeformInstruction ?? '';
      return `${instruction}${sel}`;
    }
    case 'ask': {
      if (!input.freeformInstruction) {
        throw new PromptValidationError('freeformInstruction is required for action "ask"');
      }
      return renderAskUserContent({
        freeformInstruction: input.freeformInstruction,
        selectionText: input.selectedText,
      });
    }
  }
}

// ─── Core builder ─────────────────────────────────────────────────────────────

export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const { modelContextLength } = input;

  const responseBudgetTokens = Math.floor(modelContextLength * 0.2);
  const promptBudgetTokens = Math.floor(modelContextLength * 0.8);

  const systemContent = resolvePrompt(input.userPrompts, 'system');
  const includeVeniceSystemPrompt = input.includeVeniceSystemPrompt ?? true;

  const worldNotesBlock =
    input.worldNotes && input.worldNotes.length > 0 ? `World notes:\n${input.worldNotes}` : '';

  const charactersBlock =
    input.characters.length > 0
      ? `Characters:\n${input.characters
          .map((c) => {
            const role = c.role ?? '';
            const traits = c.keyTraits ?? '';
            if (role && traits) return `- ${c.name} (${role}): ${traits}`;
            if (role) return `- ${c.name} (${role})`;
            if (traits) return `- ${c.name}: ${traits}`;
            return `- ${c.name}`;
          })
          .join('\n')}`
      : '';

  const taskBlock = buildTaskBlock(input);

  const sysTokens = estimateTokens(systemContent);
  const fixedTokens =
    sysTokens +
    estimateTokens(worldNotesBlock) +
    estimateTokens(charactersBlock) +
    estimateTokens(taskBlock);

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

  const userParts = [worldNotesBlock, charactersBlock, chapterBlock, taskBlock].filter(
    (p) => p.length > 0,
  );
  const userContent = userParts.join('\n\n');

  return {
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
    venice_parameters: {
      include_venice_system_prompt: includeVeniceSystemPrompt,
    },
    max_completion_tokens: responseBudgetTokens,
  };
}
