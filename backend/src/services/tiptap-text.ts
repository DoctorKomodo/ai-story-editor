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
  'hardBreak',
]);

function isBlockNode(node: TipTapNode): boolean {
  return BLOCK_TYPES.has(node.type ?? '');
}

function extractText(node: TipTapNode): string {
  // Leaf text node
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text;
  }

  if (!Array.isArray(node.content) || node.content.length === 0) {
    return '';
  }

  // Collect children
  const parts: string[] = [];
  for (const child of node.content) {
    const text = extractText(child);
    if (text.length > 0) {
      parts.push(text);
    }
  }

  // Block nodes separate their children with double newlines; inline nodes join directly.
  if (isBlockNode(node)) {
    return parts.join('\n\n');
  }
  return parts.join('');
}

/**
 * Convert a TipTap document tree (parsed JSON) to plain text.
 * Returns '' for null / non-object input.
 */
export function tipTapJsonToText(tree: unknown): string {
  if (!tree || typeof tree !== 'object') return '';
  return extractText(tree as TipTapNode).trim();
}
