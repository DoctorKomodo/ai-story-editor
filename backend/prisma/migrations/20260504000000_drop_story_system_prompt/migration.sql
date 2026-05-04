-- [X29] Drop per-story system-prompt ciphertext triple. User-level
-- prompt overrides live in User.settingsJson.prompts (no schema change
-- needed for that — it's a JSON blob).
ALTER TABLE "Story"
  DROP COLUMN "systemPromptCiphertext",
  DROP COLUMN "systemPromptIv",
  DROP COLUMN "systemPromptAuthTag";
