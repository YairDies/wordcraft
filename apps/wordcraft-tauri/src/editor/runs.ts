import { Fragment } from "prosemirror-model";
import type { Node as PMNode } from "prosemirror-model";
import type { RunOut } from "../bridge/sync";
import { wordcraftSchema } from "./schema";

const markNames = ["bold", "italic", "underline"] as const;

/** Text of a block's inline content, one entry per text node, with its marks. */
function inlineRuns(node: PMNode): RunOut[] {
  const runs: RunOut[] = [];
  node.forEach((child) => {
    if (!child.isText) return;
    const has = (name: string) => child.marks.some((mark) => mark.type.name === name);
    runs.push({
      text: child.text ?? "",
      bold: has("bold"),
      italic: has("italic"),
      underline: has("underline"),
    });
  });
  return runs;
}

/** Runs of a top-level block, for comparing the projection with the engine's answer. */
export function blockRuns(doc: PMNode, index: number): RunOut[] | null {
  const block = doc.child(index);
  if (!block || !block.isTextblock) return null;
  return inlineRuns(block);
}

/** Whether the engine's runs and the editor's runs describe the same text and formatting. */
export function sameRuns(a: RunOut[], b: RunOut[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x.text !== y.text) return false;
    for (const name of markNames) {
      if (x[name] !== y[name]) return false;
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
    nodes.push(wordcraftSchema.text(run.text, marks));
  }
  return Fragment.fromArray(nodes);
}
