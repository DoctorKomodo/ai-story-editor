// X28 — single source of truth (backend side) for the global fallback used
// when neither the user's per-model override nor Venice's per-model
// `model_spec.constraints` provides a value. Mirrored in
// `frontend/src/lib/textGenDefaults.ts`; backend/tests/lib/text-gen-defaults.test.ts
// catches drift between the two.
export interface GlobalTextGenDefaults {
  temperature: number;
  topP: number;
  maxTokens: number;
}

export const GLOBAL_TEXT_GEN_DEFAULTS: Readonly<GlobalTextGenDefaults> = Object.freeze({
  temperature: 1.0,
  topP: 0.95,
  maxTokens: 800,
});
