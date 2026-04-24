// [F20] Pure TipTap-JSON → plain-text serialization helpers.
//
// These produce a minimal, deterministic .txt rendering of the TipTap document
// tree used by the editor. Scope is intentionally narrow — block nodes become
// lines; inline text nodes contribute their literal text; a small set of
// structural nodes (paragraphs, headings, lists, blockquote, codeBlock,
// horizontalRule, hardBreak) are understood. Marks are ignored — plain text
// carries no styling.
//
// No mockup fidelity: this is a utility module, not a rendered surface.

import type { JSONContent } from '@tiptap/core';

type SegmentKind = 'block' | 'listItem' | 'rule';

interface Segment {
  kind: SegmentKind;
  text: string;
}

/**
 * Flatten inline content — text + hardBreak — into a single string. Marks
 * and attrs are ignored; only the literal text survives. Recurses through
 * any nested inline containers we don't explicitly understand, so that
 * mark-wrapped text (`text` nodes inside bold/italic wrappers, etc.) still
 * contributes its text.
 */
function collectInline(children: readonly JSONContent[]): string {
  let out = '';
  for (const child of children) {
    if (child.type === 'text') {
      out += child.text ?? '';
    } else if (child.type === 'hardBreak') {
      out += '\n';
    } else if (Array.isArray(child.content)) {
      out += collectInline(child.content);
    }
  }
  return out;
}

/**
 * Unwrap a listItem's content to the inline nodes inside. listItems
 * conventionally wrap a single paragraph; if so we lift that paragraph's
 * children. Otherwise we flatten one level of block content into inline.
 */
function listItemInline(item: JSONContent): readonly JSONContent[] {
  const children = item.content ?? [];
  if (children.length === 1) {
    const only = children[0]!;
    if (
      only.type === 'paragraph' ||
      only.type === 'heading' ||
      only.type === 'blockquote'
    ) {
      return only.content ?? [];
    }
  }
  const flat: JSONContent[] = [];
  for (const c of children) {
    if (c.type === 'text' || c.type === 'hardBreak') {
      flat.push(c);
    } else if (Array.isArray(c.content)) {
      for (const gc of c.content) {
        flat.push(gc);
      }
    }
  }
  return flat;
}

/**
 * Walk the tree and emit one segment per block-level node. The separator
 * between segments depends on their kinds (listItem↔listItem gets a single
 * newline; everything else gets a blank line).
 */
function emit(node: JSONContent, out: Segment[]): void {
  const type = node.type;

  if (type === 'horizontalRule') {
    out.push({ kind: 'rule', text: '---' });
    return;
  }

  if (type === 'bulletList' || type === 'orderedList') {
    for (const child of node.content ?? []) {
      if (child.type === 'listItem') {
        out.push({ kind: 'listItem', text: collectInline(listItemInline(child)) });
      } else {
        emit(child, out);
      }
    }
    return;
  }

  if (
    type === 'paragraph' ||
    type === 'heading' ||
    type === 'blockquote' ||
    type === 'codeBlock' ||
    type === 'listItem'
  ) {
    out.push({ kind: 'block', text: collectInline(node.content ?? []) });
    return;
  }

  // Unknown/container (incl. 'doc' if someone passes it here directly):
  // recurse into children.
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      emit(child, out);
    }
  }
}

/**
 * Render a TipTap document tree as plain text. Returns "" for null or
 * empty-content docs; otherwise returns the rendered text with trailing
 * whitespace trimmed (no trailing newline).
 */
export function tipTapJsonToPlainText(doc: JSONContent | null): string {
  if (doc === null) return '';
  const content = doc.content;
  if (!Array.isArray(content) || content.length === 0) return '';

  const segments: Segment[] = [];
  for (const child of content) {
    emit(child, segments);
  }

  let result = '';
  for (let i = 0; i < segments.length; i += 1) {
    const cur = segments[i]!;
    if (i === 0) {
      result += cur.text;
      continue;
    }
    const prev = segments[i - 1]!;
    if (prev.kind === 'listItem' && cur.kind === 'listItem') {
      result += '\n' + cur.text;
    } else {
      result += '\n\n' + cur.text;
    }
  }

  return result.replace(/\s+$/, '');
}

/**
 * Serialize a single chapter to `"{title}\n\n{plaintext}"`. When the body is
 * empty, emit only the title + trailing newline — no dangling blank line.
 */
export function serializeChapterTxt(chapter: {
  title: string;
  bodyJson: JSONContent | null;
}): string {
  const body = tipTapJsonToPlainText(chapter.bodyJson);
  if (body === '') return `${chapter.title}\n`;
  return `${chapter.title}\n\n${body}`;
}

/**
 * Serialize an entire story: title, then chapters (sorted by orderIndex)
 * joined by a horizontal-rule delimiter.
 */
export function serializeStoryTxt(story: {
  title: string;
  chapters: Array<{ title: string; orderIndex: number; bodyJson: JSONContent | null }>;
}): string {
  const sorted = [...story.chapters].sort((a, b) => a.orderIndex - b.orderIndex);
  const body = sorted.map(serializeChapterTxt).join('\n\n---\n\n');
  return `${story.title}\n\n${body}`;
}
