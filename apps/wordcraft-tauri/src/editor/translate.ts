import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from "prosemirror-transform";
import type { Slice } from "prosemirror-model";
import type { Node as PMNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import type { SyncOp } from "../bridge/sync";

/**
 * Translates a ProseMirror transaction into engine operations.
 *
 * ProseMirror positions are integers into the *tree*, so a position only means something once it
 * is resolved against a specific document version. `tr.docs[i]` is the document the i-th step
 * was applied to, and the engine applies our operations in order, so using `tr.docs[i]` keeps
 * the two in step: after operation k the engine is in exactly the state step k+1 was written for.
 *
 * Anything this module cannot express faithfully is reported as unsupported and the caller must
 * refuse the edit rather than apply it locally. Letting ProseMirror drift from the engine would
 * make the engine's authority a lie.
 */

export interface Translation {
  ops: SyncOp[];
  /** Set when the transaction contains something the engine cannot express yet. */
  unsupported?: string;
}

interface Located {
  block: number;
  offset: number;
}

/**
 * Where a document position sits: top-level block index and inline offset in UTF-16 units.
 *
 * The offset must be relative to the paragraph's content, not to the document. Computing it from
 * `ResolvedPos.start(0)` silently yields the document-level start (0), which turns every offset
 * into an absolute document position and makes the engine insert text in the wrong paragraph. The
 * children are walked instead: a block starting at `start` occupies `start .. start + nodeSize`,
 * and its content runs from `start + 1` to `start + nodeSize - 1`.
 */
function locate(doc: PMNode, pos: number): Located | null {
  let start = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const node = doc.child(i);
    const end = start + node.nodeSize;
    if (pos > start && pos < end) {
      if (!node.isTextblock) return null;
      return { block: i, offset: pos - (start + 1) };
    }
    start = end;
  }
  return null;
}

/** The plain text of a slice, or null when it holds anything but text. */
function sliceText(slice: Slice): string | null {
  let text = "";
  let onlyText = true;
  slice.content.forEach((node) => {
    if (!node.isText) {
      onlyText = false;
      return;
    }
    text += node.text ?? "";
  });
  return onlyText ? text : null;
}

export function translateTransaction(tr: Transaction): Translation {
  const ops: SyncOp[] = [];
  for (let i = 0; i < tr.steps.length; i += 1) {
    const step = tr.steps[i];
    const doc = tr.docs[i] ?? tr.before;

    if (step instanceof ReplaceAroundStep) {
      // Wrapping or unwrapping a node (a list, a blockquote): a structural change.
      return { ops, unsupported: "wrapping or unwrapping a block" };
    }

    if (step instanceof ReplaceStep) {
      const from = locate(doc, step.from);
      const to = locate(doc, step.to);
      if (!from || !to) return { ops, unsupported: "edit outside a top-level paragraph" };
      const text = sliceText(step.slice);
      if (text === null) return { ops, unsupported: "insertion of non-text content" };

      if (step.to > step.from) {
        if (from.block !== to.block) {
          // The engine would join the paragraphs, which renumbers every later block and breaks
          // the block-index mapping the projection relies on.
          return { ops, unsupported: "deleting across paragraphs" };
        }
        ops.push({
          op: "DeleteRange",
          from_block: from.block,
          from_offset: from.offset,
          to_block: to.block,
          to_offset: to.offset,
        });
      }
      if (text) {
        ops.push({ op: "InsertText", block: from.block, offset: from.offset, text });
      }
      continue;
    }

    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      const name = step.mark.type.name;
      if (name !== "bold" && name !== "italic") return { ops, unsupported: `the "${name}" mark` };
      const from = locate(doc, step.from);
      const to = locate(doc, step.to);
      if (!from || !to || from.block !== to.block) return { ops, unsupported: "formatting across paragraphs" };
      ops.push({ op: "SetMark", block: from.block, from: from.offset, to: to.offset, mark: name, on: step instanceof AddMarkStep });
      continue;
    }

    return { ops, unsupported: step.constructor?.name ?? "an unknown step" };
  }
  return { ops };
}

/**
 * The blocks of a document, each as plain text. Used to seed the engine: after this call the
 * engine owns the text and the editor follows its answers.
 */
export function documentBlocks(doc: PMNode): string[] {
  const out: string[] = [];
  for (let i = 0; i < doc.childCount; i += 1) {
    const block = doc.child(i);
    // A block the bridge cannot hold (a table) still occupies an index, so it is seeded as an
    // empty placeholder paragraph. Skipping it would shift every later block and silently map
    // the person's typing onto the wrong paragraph.
    out.push(block.isTextblock ? block.textContent : "");
  }
  return out;
}
