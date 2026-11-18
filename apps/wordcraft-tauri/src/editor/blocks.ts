import type { Node as PMNode } from "prosemirror-model";

/**
 * Every textblock ProseMirror addresses in document order, nested content included.
 *
 * An "ordinal" is the index of a textblock in that order, and it is the only stable link between
 * the two models: the engine's `para_paths` walks its document in the same order, so the n-th
 * ProseMirror textblock is the n-th engine paragraph — a top-level paragraph, a list item or a
 * table cell alike. That is what lets one addressing scheme cover all three.
 */
export interface Textblock {
  node: PMNode;
  /** Position of the block itself (its content starts at `start`). */
  pos: number;
  /** Position of the first character inside the block. */
  start: number;
  ordinal: number;
}

export function textblocks(doc: PMNode): Textblock[] {
  const out: Textblock[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      out.push({ node, pos, start: pos + 1, ordinal: out.length });
      return false;
    }
    return true;
  });
  return out;
}

/** The textblock containing a document position, with the offset inside its content. */
export function locate(doc: PMNode, pos: number): { ordinal: number; offset: number } | null {
  for (const block of textblocks(doc)) {
    const end = block.start + block.node.content.size;
    if (pos >= block.start && pos <= end) {
      return { ordinal: block.ordinal, offset: pos - block.start };
    }
  }
  return null;
}

export function blockAt(doc: PMNode, ordinal: number): Textblock | null {
  return textblocks(doc)[ordinal] ?? null;
}

/** A key for a block path, for reversing an engine projection into an ordinal. */
export const pathKey = (path: readonly number[]): string => path.join(".");
