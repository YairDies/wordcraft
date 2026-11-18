import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from "prosemirror-transform";
import type { Slice } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import type { SyncOp } from "../bridge/sync";
import { locate } from "./blocks";

/**
 * Translates a ProseMirror transaction into engine operations.
 *
 * ProseMirror positions only mean something against a specific document version, so each step is
 * read against `tr.docs[i]` — the document that step was applied to. The engine applies our
 * operations in order, so after operation k it is in exactly the state step k+1 was written for.
 *
 * Text and marks are translated exactly. Anything that changes the *structure* — Enter, joining
 * paragraphs, deleting across paragraphs, a new list or table — is reported as structural and the
 * caller re-seeds the engine from the editor's document. That keeps the engine's copy complete
 * without needing to replay structural changes op by op.
 */
export interface Translation {
  ops: SyncOp[];
  /** The edit changed the document's structure; the engine must be re-seeded. */
  structural?: string;
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

export function translateTransaction(tr: Transaction, paths: readonly number[][]): Translation {
  const ops: SyncOp[] = [];
  const pathOf = (ordinal: number): number[] | null => paths[ordinal] ?? null;

  for (let i = 0; i < tr.steps.length; i += 1) {
    const step = tr.steps[i];
    const doc = tr.docs[i] ?? tr.before;

    if (step instanceof ReplaceAroundStep) return { ops, structural: "wrapping or unwrapping a block" };

    if (step instanceof ReplaceStep) {
      const from = locate(doc, step.from);
      const to = locate(doc, step.to);
      if (!from || !to) return { ops, structural: "an edit outside a text block" };
      if (from.ordinal !== to.ordinal) return { ops, structural: "an edit across paragraphs" };

      const text = sliceText(step.slice);
      if (text === null) return { ops, structural: "inserted non-text content" };

      const path = pathOf(from.ordinal);
      if (!path) return { ops, structural: `no engine block for paragraph ${from.ordinal}` };

      if (step.to > step.from) {
        ops.push({ op: "DeleteRange", from_path: path, from_offset: from.offset, to_path: path, to_offset: to.offset });
      }
      if (text) {
        ops.push({ op: "InsertText", path, offset: from.offset, text });
      }
      continue;
    }

    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      const name = step.mark.type.name;
      if (name !== "bold" && name !== "italic" && name !== "underline" && name !== "strike") {
        return { ops, structural: `the "${name}" mark` };
      }
      const from = locate(doc, step.from);
      const to = locate(doc, step.to);
      if (!from || !to || from.ordinal !== to.ordinal) return { ops, structural: "formatting across paragraphs" };
      const path = pathOf(from.ordinal);
      if (!path) return { ops, structural: `no engine block for paragraph ${from.ordinal}` };
      ops.push({ op: "SetMark", path, from: from.offset, to: to.offset, mark: name, on: step instanceof AddMarkStep });
      continue;
    }

    return { ops, structural: step.constructor?.name ?? "an unknown step" };
  }
  return { ops };
}
