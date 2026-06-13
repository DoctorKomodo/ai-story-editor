// X28 — frontend mirror of backend/src/lib/text-gen-defaults.ts. Drift
// caught by backend/tests/lib/text-gen-defaults.test.ts.
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
