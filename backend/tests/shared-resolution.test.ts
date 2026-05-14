import { STORY_TITLE_MAX } from 'story-editor-shared';
import { describe, expect, it } from 'vitest';

// Resolution smoke for `story-editor-shared` (originally a story-editor-at5
// regression guard). Proves the backend vitest config resolves the shared
// package and that a runtime value imports from it — in the vitest env that
// goes through the `story-editor-shared` -> ../shared/src `resolve.alias` in
// backend/vitest.config.ts. After story-editor-8i9 there is no `shared/dist`
// at all: prod bundles shared into the artifact and dev/test resolve source.
describe('story-editor-shared resolution (backend)', () => {
  it('imports a runtime value from the shared package', () => {
    expect(typeof STORY_TITLE_MAX).toBe('number');
  });
});
