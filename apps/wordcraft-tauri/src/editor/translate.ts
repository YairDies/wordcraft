import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from "prosemirror-transform";
import type { Slice } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import type { EngineCursor, SyncOp } from "../bridge/sync";
import { locate } from "./blocks";

/**
 * Translates a ProseMirror transaction into engine operations.
 *
 * Text operations name no position: the engine keeps the cursor and acts where it is. Each step is
 * therefore preceded by the operation that puts the engine's cursor or selection where the step
 * expects it — unless it is already there, which is the typing case, because the engine advanced
 * its own cursor as it inserted.
 *
 * That is what removes the failure this bridge kept hitting: a keystroke used to be addressed by a
 * block path computed at translation time, and a concurrent structural edit could move the block
 * underneath it. A position the engine owns cannot be moved underneath it.
 */
export interface Translation {
  ops: SyncOp[];
  /** The edit changed the document's structure, so the view is rebuilt from the engine. */
  structural?: boolean;
  /** Set when the edit cannot be expressed as engine operations at all. */
  unsupported?: string;
}

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

const same = (a: EngineCursor | null, path: number[], offset: number): boolean =>
  a !== null && a.offset === offset && a.path.length === path.length && a.path.every((v, i) => v === path[i]);

export function translateTransaction(
  tr: Transaction,
  paths: readonly number[][],
  engineCursor: EngineCursor | null,
): Translation {
  const ops: SyncOp[] = [];
  let structural = false;
  let cursor = engineCursor;
  const pathOf = (ordinal: number): number[] | null => paths[ordinal] ?? null;

  /** Put the engine's caret at a position, unless it is already there. */
  const ensureCaret = (ordinal: number, offset: number): boolean => {
    const path = pathOf(ordinal);
    if (!path) return false;
    if (!same(cursor, path, offset)) {
      ops.push({ op: "CursorMove", path, offset });
      cursor = { path, offset };
    }
    return true;
  };

  for (let i = 0; i < tr.steps.length; i += 1) {
    const step = tr.steps[i];
    const doc = tr.docs[i] ?? tr.before;

    if (step instanceof ReplaceAroundStep) return { ops, structural: true };

    if (step instanceof ReplaceStep) {
      const from = locate(doc, step.from);
      const to = locate(doc, step.to);
      if (!from || !to) return { ops, unsupported: "an edit outside a text block" };

      // Enter: a collapsed caret with a block in the slice.
      if (step.from === step.to && !sliceText(step.slice)?.length && step.slice.content.childCount > 0) {
        if (!ensureCaret(from.ordinal, from.offset)) return { ops, unsupported: "no engine block for the caret" };
        ops.push({ op: "SplitBlock" });
        structural = true;
        // The engine moves its own cursor into the new paragraph.
        cursor = null;
        continue;
      }

      const text = sliceText(step.slice);
      if (text === null) return { ops, unsupported: "inserted non-text content" };

      if (step.to > step.from) {
        const fromPath = pathOf(from.ordinal);
        const toPath = pathOf(to.ordinal);
        if (!fromPath || !toPath) return { ops, unsupported: "no engine block for the selection" };
        ops.push({
          op: "SelectRange",
          from_path: fromPath,
          from_offset: from.offset,
          to_path: toPath,
          to_offset: to.offset,
        });
        ops.push({ op: "DeleteSelection" });
        cursor = null;
        if (from.ordinal !== to.ordinal) structural = true;
      }

      if (text) {
        // After a deletion the engine's caret sits where the deleted range began.
        if (!ensureCaret(from.ordinal, from.offset)) return { ops, unsupported: "no engine block for the caret" };
        ops.push({ op: "InsertText", text });
        cursor = { path: pathOf(from.ordinal) as number[], offset: from.offset + text.length };
      }

      // A replacement that spans blocks joins them, which renumbers everything after.
      if (from.ordinal !== to.ordinal && text) structural = true;
      continue;
    }

    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      const name = step.mark.type.name;
      if (name !== "bold" && name !== "italic" && name !== "underline" && name !== "strike") {
        return { ops, unsupported: `the "${name}" mark` };
      }
      const from = locate(doc, step.from);
      const to = locate(doc, step.to);
      if (!from || !to) return { ops, unsupported: "formatting outside a text block" };
      const fromPath = pathOf(from.ordinal);
      const toPath = pathOf(to.ordinal);
      if (!fromPath || !toPath) return { ops, unsupported: "no engine block for the selection" };
      ops.push({
        op: "SelectRange",
        from_path: fromPath,
        from_offset: from.offset,
        to_path: toPath,
        to_offset: to.offset,
      });
      ops.push({ op: "SetMark", mark: name, on: step instanceof AddMarkStep });
      cursor = null;
      continue;
    }

    return { ops, unsupported: step.constructor?.name ?? "an unknown step" };
  }
  return { ops, structural: structural || undefined };
}