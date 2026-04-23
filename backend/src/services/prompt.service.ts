// Pure, no IO, no async — intentionally so. `stream` and `model` are injected
// by the route layer so this module stays unit-testable without HTTP or Venice
// client dependencies.

export type PromptAction =
  | 'continue'
  | 'rephrase'
  | 'expand'
  | 'summarise'
  | 'freeform'
  | 'rewrite'   // mockup selection-bubble vocabulary (visible "Rewrite" button); rephrase is the AI-panel vocabulary from [F12] — both coexist to avoid breaking either surface's contract
  | 'describe'  // elaborate with vivid sensory/physical/emotional detail
  | 'ask';      // chat-attachment pathway — NOT valid on /complete; only used via the chat message route (V16)

export interface CharacterContext {
  name: string;
  role?: string | null;
  keyTraits?: string | null;
}

export interface BuildPromptInput {
  action: PromptAction;
  selectedText: string;
  chapterContent: string;
  characters: CharacterContext[];
  worldNotes: string | null;
  modelContextLength: number;
  /** [V4] — default true when omitted */
  includeVeniceSystemPrompt?: boolean;
  /** If non-null / non-empty, replaces the default creative-writing system message */
  storySystemPrompt?: string | null;
  /** Required when action === 'freeform' or 'ask'; optional otherwise */
  freeformInstruction?: string;
}

export interface BuiltPrompt {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  venice_parameters: {
    include_venice_system_prompt: boolean;
  };
  max_tokens: number;
}

// ─── Exported constants ───────────────────────────────────────────────────────

export const DEFAULT_SYSTEM_PROMPT =
  'You are an expert creative-writing assistant. ' +
  'Help the author continue, refine, and develop their story with vivid prose that matches their established voice and tone. ' +
  'Return only the requested content — no preamble, no meta-commentary, no quotation marks around the output.';

// ─── Token estimation ─────────────────────────────────────────────────────────

// chars/4 is a conservative over-estimate chosen to avoid an external tokenizer dependency;
// good enough since the 20% response headroom absorbs the approximation.
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

// ─── Action task block ────────────────────────────────────────────────────────

function buildTaskBlock(input: BuildPromptInput): string {
  const sel = input.selectedText ? `\n\nSelection: «${input.selectedText}»` : '';
  switch (input.action) {
    case 'continue':
      // ~80-word target aligns with the ⌥↵ cursor-context continuation shortcut (V14).
      return `Task: continue the story from where the selection ends, matching the established voice. Aim for roughly 80–150 words.${sel}`;
    case 'rephrase':
      return `Task: rephrase the selection, preserving meaning. Return a single rewritten version.${sel}`;
    case 'expand':
      return `Task: expand the selection with more detail, description, and depth. Keep the same POV, tense, and voice.${sel}`;
    case 'summarise':
      return `Task: summarise the selection to its essential points. Use 1–3 sentences.${sel}`;
    case 'freeform': {
      const instruction = input.freeformInstruction ?? '';
      return `${instruction}${sel}`;
    }
    // ── V14 additions ──────────────────────────────────────────────────────
    case 'rewrite':
      // rewrite = mockup selection-bubble vocabulary; rephrase = AI-panel vocabulary.
      // Near-identical intent — both are kept to avoid breaking either surface's contract.
      return `Task: rewrite the selection with different phrasing while preserving meaning and voice. Return a single alternative version.${sel}`;
    case 'describe':
      return `Task: describe the subject of the selection with vivid sensory, physical, and emotional detail. Maintain the story's POV and tense.${sel}`;
    case 'ask': {
      // ask routes selection into chat as an attachment (V16). freeformInstruction is required.
      if (!input.freeformInstruction) {
        throw new Error('freeformInstruction is required for action "ask"');
      }
      const attached = input.selectedText ? `\n\nAttached selection: «${input.selectedText}»` : '';
      return `User question: ${input.freeformInstruction}${attached}`;
    }
  }
}

// ─── Core builder ─────────────────────────────────────────────────────────────

export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const { modelContextLength } = input;

  // Budget
  const responseBudgetTokens = Math.floor(modelContextLength * 0.2);
  const promptBudgetTokens = Math.floor(modelContextLength * 0.8);

  // System message
  const systemContent =
    input.storySystemPrompt && input.storySystemPrompt.trim().length > 0
      ? input.storySystemPrompt
      : DEFAULT_SYSTEM_PROMPT;

  const includeVeniceSystemPrompt = input.includeVeniceSystemPrompt ?? true;

  // ── Build the fixed (non-truncatable) blocks ──────────────────────────────

  // World notes block — never truncated
  const worldNotesBlock =
    input.worldNotes && input.worldNotes.length > 0
      ? `World notes:\n${input.worldNotes}`
      : '';

  // Characters block — never truncated
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

  // Task block — not truncated
  const taskBlock = buildTaskBlock(input);

  // ── Compute token budget remaining for chapterContent ─────────────────────
  // System tokens count against the prompt budget
  const sysTokens = estimateTokens(systemContent);
  const fixedTokens =
    sysTokens +
    estimateTokens(worldNotesBlock) +
    estimateTokens(charactersBlock) +
    estimateTokens(taskBlock);

  const chapterBudgetTokens = promptBudgetTokens - fixedTokens;

  // Truncate chapterContent from the top (oldest content first) if needed
  let chapterText = input.chapterContent;
  if (chapterBudgetTokens <= 0) {
    chapterText = '';
  } else {
    const maxChapterChars = chapterBudgetTokens * 4; // inverse of estimateTokens
    if (chapterText.length > maxChapterChars) {
      // Keep the tail (newest content)
      chapterText = chapterText.slice(chapterText.length - maxChapterChars);
    }
  }

  const chapterBlock =
    chapterText.length > 0 ? `Chapter so far:\n${chapterText}` : '';

  // ── Assemble the user message ─────────────────────────────────────────────
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
    max_tokens: responseBudgetTokens,
  };
}
