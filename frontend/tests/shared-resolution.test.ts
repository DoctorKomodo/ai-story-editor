import { STORY_TITLE_MAX } from 'story-editor-shared';
import { describe, expect, it } from 'vitest';

// Regression guard for story-editor-at5. Proves the frontend vitest config
// resolves `story-editor-shared` to shared/src — not the compiled
// shared/dist. The bd verify line runs this with `shared/dist` deleted, so
// it fails fast ("Cannot find module") if the resolve.alias is ever removed.
describe('story-editor-shared resolution (frontend)', () => {
  it('imports a runtime value from the shared package', () => {
    expect(typeof STORY_TITLE_MAX).toBe('number');
  });
});
