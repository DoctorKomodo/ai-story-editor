import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement Range#getClientRects / getBoundingClientRect;
// ProseMirror v3 (used by tiptap v3) calls them via coordsAtPos during
// scrollToSelection on every transaction. Provide stubs so transactions
// don't bubble unhandled exceptions through the test runner.
const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
const rectList: DOMRectList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects = (): DOMRectList => rectList;
  Range.prototype.getBoundingClientRect = (): DOMRect =>
    ({ ...rect, toJSON: () => rect }) as DOMRect;
}
if (typeof Element !== 'undefined' && !Element.prototype.getClientRects) {
  Element.prototype.getClientRects = function getClientRects(): DOMRectList {
    return rectList;
  };
}
