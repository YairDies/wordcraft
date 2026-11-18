import type { Node as PMNode } from "prosemirror-model";
import type { ProjectedBlock, RunOut } from "../bridge/sync";
import { wordcraftSchema } from "./schema";
import { runsToFragment } from "./runs";

/**
 * Turns the engine's document tree back into a ProseMirror document.
 *
 * This is the inverse of `seed.ts`: the engine owns the document, and after a structural edit the
 * view is rebuilt from it rather than being corrected block by block. That is what removes the
 * window in which block indices had moved but the view still held the old ones.
 */
export function structureToDoc(blocks: ProjectedBlock[]): PMNode {
  const nodes = blocks.map(toNode).filter((node): node is PMNode => node !== null);
  return wordcraftSchema.node("doc", null, nodes.length ? nodes : [wordcraftSchema.node("paragraph")]);
}

function textblock(nodeName: "paragraph", runs: RunOut[]): PMNode {
  return wordcraftSchema.nodes[nodeName].create(null, runsToFragment(runs));
}

function toNode(block: ProjectedBlock): PMNode | null {
  const { nodes } = wordcraftSchema;
  switch (block.kind) {
    case "para":
      return textblock("paragraph", block.runs);
    case "heading":
      return nodes.heading.create({ level: Math.min(6, Math.max(1, Number(block.level) || 1)) }, runsToFragment(block.runs));
    case "list": {
      const listType = block.ordered ? nodes.orderedList : nodes.bulletList;
      const items = block.items.map((runs) => nodes.listItem.create(null, textblock("paragraph", runs)));
      return listType.create(null, items.length ? items : [nodes.listItem.create(null, textblock("paragraph", []))]);
    }
    case "table": {
      const rows = block.rows.map((row) => {
        const cells = row.map((paragraphs) => {
          const content = paragraphs.map((runs) => textblock("paragraph", runs));
          return nodes.table_cell.create(null, content.length ? content : [textblock("paragraph", [])]);
        });
        return nodes.table_row.create(null, cells);
      });
      if (!rows.length) return null;
      return nodes.table.create(null, rows);
    }
    default:
      return null;
  }
}
