import { Fragment } from "prosemirror-model";
import type { Node as PMNode } from "prosemirror-model";
import type { RunOut } from "../bridge/sync";
import { blockAt } from "./blocks";
import { wordcraftSchema } from "./schema";

const markChecks = [
  { name: "bold", of: (run: RunOut) => run.bold },
  { name: "italic", of: (run: RunOut) => run.italic },
  { name: "underline", of: (run: RunOut) => run.underline },
  { name: "strike", of: (run: RunOut) => run.strike },
] as const;

/** Runs of a textblock, by ordinal, for comparing the projection with the engine's answer. */
export function blockRuns(doc: PMNode, ordinal: number): RunOut[] | null {
  const block = blockAt(doc, ordinal);
  if (!block) return null;
  const runs: RunOut[] = [];
  block.node.forEach((child) => {
    if (!child.isText) return;
    const has = (name: string) => child.marks.some((mark) => mark.type.name === name);
    runs.push({
      text: child.text ?? "",
      bold: has("bold"),
      italic: has("italic"),
      underline: has("underline"),
      strike: has("strike"),
    });
  });
  return runs;
}

/** Whether the engine's runs and the editor's runs describe the same text and formatting. */
export function sameRuns(a: RunOut[], b: RunOut[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].text !== b[i].text) return false;
    for (const check of markChecks) {
      if (check.of(a[i]) !== check.of(b[i])) return false;
    }
  }
  return true;
}

/** Build inline ProseMirror content from the engine's runs. */
export function runsToFragment(runs: RunOut[]): Fragment {
  const nodes = [];
  for (const run of runs) {
    if (!run.text) continue;
    const marks = [];
    if (run.bold) marks.push(wordcraftSchema.marks.bold.create());
    if (run.italic) marks.push(wordcraftSchema.marks.italic.create());
    if (run.underline) marks.push(wordcraftSchema.marks.underline.create());
    if (run.strike) marks.push(wordcraftSchema.marks.strike.create());
    nodes.push(wordcraftSchema.text(run.text, marks));
  }
  return Fragment.fromArray(nodes);
}
