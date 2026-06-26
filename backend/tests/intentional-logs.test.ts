import { describe, expect, it } from 'vitest';
import { isIntentionalLog } from './intentional-logs';

describe('isIntentionalLog', () => {
  it.each([
    '[venice.params] {"model":"x"}',
    '[venice.models] model "x" exposes no positive maxCompletionTokens; defaulting',
    '[venice.error] something',
    '[venice.error.dev] {\n  route: "chat"\n}', // multi-line block: matches on first line
    '[chapter.repo] summary_parse_failed for chapter abc',
    '[V15] Failed to persist assistant message',
    '[error-handler.dev] Error: boom\n    at fake (/tmp/x.ts:1:1)',
  ])('suppresses intentional log: %s', (line) => {
    expect(isIntentionalLog(line)).toBe(true);
  });

  it.each([
    '[X32] Venice rate_limits probe failed',
    '[boot] stale APP_ENCRYPTION_KEY detected; ignoring',
    '[session-store] evicted a live session under cap pressure',
    'Error: a genuinely unexpected failure',
    'some other unexpected output',
  ])('does NOT suppress: %s', (line) => {
    expect(isIntentionalLog(line)).toBe(false);
  });
});
