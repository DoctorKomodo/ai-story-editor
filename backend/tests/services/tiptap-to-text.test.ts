// [B10] Unit tests for tipTapJsonToText — the TipTap-to-plaintext converter
// used by the chapter save pipeline to derive wordCount from a bodyJson tree.
//
// Covers: block node separation, inline concatenation, hardBreak behaviour,
// marks (bold/italic spans) rendering as plain text, nested lists, and
// null / non-object inputs.

import { describe, expect, it } from 'vitest';
import { tipTapJsonToText } from '../../src/services/tiptap-text';

describe('tipTapJsonToText', () => {
  // ── Null / non-object inputs ─────────────────────────────────────────────

  it('returns empty string for null', () => {
    expect(tipTapJsonToText(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(tipTapJsonToText(undefined)).toBe('');
  });

  it('returns empty string for non-object input', () => {
    expect(tipTapJsonToText('string')).toBe('');
    expect(tipTapJsonToText(42)).toBe('');
    expect(tipTapJsonToText(true)).toBe('');
  });

  it('handles an empty doc gracefully', () => {
    const doc = { type: 'doc', content: [] };
    expect(tipTapJsonToText(doc)).toBe('');
  });

  it('returns empty string for a doc with only empty paragraphs', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [] },
      ],
    };
    expect(tipTapJsonToText(doc)).toBe('');
  });

  // ── Simple block extraction ──────────────────────────────────────────────

  it('extracts text from a simple paragraph', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    };
    expect(tipTapJsonToText(doc)).toBe('Hello world');
  });

  it('separates two paragraphs with double newlines', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second' }],
        },
      ],
    };
    expect(tipTapJsonToText(doc)).toBe('First\n\nSecond');
  });

  it('separates three block nodes with \\n\\n', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body one.' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body two.' }],
        },
      ],
    };
    expect(tipTapJsonToText(doc)).toBe('Title\n\nBody one.\n\nBody two.');
  });

  // ── Marks (bold, italic, etc) ────────────────────────────────────────────

  it('renders text inside marks as plain text without leaking mark metadata', () => {
    // TipTap stores marks on the text node itself (as a `marks` array) — the
    // converter ignores marks entirely and emits the raw text.
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Plain ' },
            { type: 'text', text: 'strong', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'slanted', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' text.' },
          ],
        },
      ],
    };
    const result = tipTapJsonToText(doc);
    expect(result).toBe('Plain strong and slanted text.');
    // Guard against mark/type labels from the JSON tree leaking through.
    expect(result).not.toContain('"type"');
    expect(result).not.toContain('marks');
    expect(result).not.toContain('italic');
    expect(result).not.toContain('"bold"');
  });

  // ── hardBreak (inline) ───────────────────────────────────────────────────

  it('hardBreak between two text nodes produces a single newline (not a block separator)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Line two' },
          ],
        },
      ],
    };
    const result = tipTapJsonToText(doc);
    // Inline hardBreak concatenates directly — no \n\n inflation around it.
    expect(result).toBe('Line one\nLine two');
    expect(result).not.toContain('\n\n');
  });

  it('hardBreak alone in a paragraph does not explode separators', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'hardBreak' }],
        },
      ],
    };
    const result = tipTapJsonToText(doc);
    expect(result).not.toContain('\n\n\n\n');
  });

  // ── Nested lists ─────────────────────────────────────────────────────────

  it('renders a bulletList with nested listItems separated by \\n\\n', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'First item' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Second item' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = tipTapJsonToText(doc);
    expect(result).toContain('First item');
    expect(result).toContain('Second item');
    // Both items must be present with block separation somewhere between them.
    expect(result.indexOf('First item')).toBeLessThan(result.indexOf('Second item'));
    expect(result).toContain('\n\n');
  });

  it('renders a nested orderedList within a listItem', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Outer' }],
                },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Inner' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = tipTapJsonToText(doc);
    expect(result).toContain('Outer');
    expect(result).toContain('Inner');
    expect(result.indexOf('Outer')).toBeLessThan(result.indexOf('Inner'));
  });

  // ── Regression: 2 paragraphs, 10 total words ─────────────────────────────

  it('extracts 10 words from a fixture with 2 paragraphs (wordCount regression)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'The quick brown fox jumps.' }], // 5 words
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Over the very lazy dog.' }], // 5 words
        },
      ],
    };
    const text = tipTapJsonToText(doc);
    const words = text.split(/\s+/).filter(Boolean);
    expect(words).toHaveLength(10);
  });
});
