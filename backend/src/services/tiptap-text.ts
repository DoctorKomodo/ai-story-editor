// Convert a TipTap/ProseMirror JSON tree to plain text.
// Block nodes are separated by double newlines; text nodes are concatenated.
// This helper exists so the prompt builder can receive a plain string from
// chapter bodies without ever seeing serialised JSON or ciphertext.

interface TipTapNode {
  type?: string;
  text?: string;
  content?: TipTapNode[];
}

const BLOCK_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule',
  // hardBreak is an inline element in TipTap — not a block node.
  // It is handled by the text leaf path and produces a single '\n' naturally.
]);

function isBlockNode(node: TipTapNode): boolean {
  return BLOCK_TYPES.has(node.type ?? '');
}

function extractText(node: TipTapNode): string {
  // Leaf text node
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text;
  }

  // hardBreak is an inline element — produces a single newline.
  if (node.type === 'hardBreak') {
    return '\n';
  }

  if (!Array.isArray(node.content) || node.content.length === 0) {
    return '';
  }

  if (!isBlockNode(node)) {
    // Inline container (e.g. a marks span) — concatenate children directly.
    return node.content.map(extractText).join('');
  }

  // Block container: separate block children with '\n\n' while concatenating
  // inline children (text, hardBreak, marks) directly onto their adjacent segment.
  // This avoids double-newline separation around inline nodes like hardBreak.
  const segments: string[] = [];
  let currentInline = '';

  for (const child of node.content) {
    if (isBlockNode(child)) {
      // Flush any inline accumulation before this block child.
      if (currentInline.length > 0) {
        segments.push(currentInline);
        currentInline = '';
      }
      const blockText = extractText(child);
      if (blockText.length > 0) {
        segments.push(blockText);
      }
    } else {
      // Inline child (text, hardBreak, …) — accumulate directly.
      currentInline += extractText(child);
    }
  }
  // Flush trailing inline content.
  if (currentInline.length > 0) {
    segments.push(currentInline);
  }

  return segments.join('\n\n');
}

/**
 * Convert a TipTap document tree (parsed JSON) to plain text.
 * Returns '' for null / non-object input.
 */
export function tipTapJsonToText(tree: unknown): string {
  if (!tree || typeof tree !== 'object') return '';
  return extractText(tree as TipTapNode).trim();
}
