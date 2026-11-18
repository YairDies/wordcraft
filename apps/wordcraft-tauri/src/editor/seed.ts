import type { Node as PMNode } from "prosemirror-model";
import type { SeedBlock } from "../bridge/sync";

/**
 * Describes the editor's document the way the engine needs it, so the engine can hold the whole
 * document — lists and tables included — instead of only loose paragraphs.
 *
 * Lists are flattened to one numbered paragraph per item, which is how OOXML models a list
 * (`w:numPr` on the paragraph). Tables keep their rows and cells; each cell becomes one paragraph.
 */
export function buildSeed(doc: PMNode): { blocks: SeedBlock[]; problem?: string } {
  const blocks: SeedBlock[] = [];
  for (let i = 0; i < doc.childCount; i += 1) {
    const node = doc.child(i);
    const name = node.type.name;

    if (name === "paragraph" || name === "codeBlock" || name === "blockquote") {
      blocks.push({ kind: "para", text: node.textContent });
      continue;
    }
    if (name === "heading") {
      blocks.push({ kind: "heading", text: node.textContent, level: Number(node.attrs.level) || 1 });
      continue;
    }
    if (name === "bulletList" || name === "orderedList" || name === "taskList") {
      // Importers nest each following item inside the previous one (listItem > paragraph +
      // listItem...), so walking the items one level deep sees a single item with many
      // paragraphs. Every descendant textblock is one engine paragraph, in document order, which
      // is exactly the addressing the bridge uses — nested lists therefore flatten to one level.
      const items: string[] = [];
      node.descendants((child) => {
        if (child.isTextblock) {
          items.push(child.textContent);
          return false;
        }
        return true;
      });
      if (!items.length) return { blocks, problem: "an empty list" };
      blocks.push({ kind: "list", ordered: name === "orderedList", items });
      continue;
    }
    if (name === "table") {
      // One engine paragraph per cell. A cell holding several paragraphs would need several, and
      // the engine's cell model supports that; this seed keeps one, joining with a manual line
      // break (\n), which is what Word writes for Shift+Enter inside a cell.
      const rows: string[][] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => {
          const paragraphs: string[] = [];
          cell.forEach((child) => paragraphs.push(child.textContent));
          cells.push(paragraphs.join("\n"));
        });
        rows.push(cells);
      });
      blocks.push({ kind: "table", rows });
      continue;
    }
    // Anything else (an image on its own, a horizontal rule) carries no addressable text.
    blocks.push({ kind: "para", text: node.textContent });
  }
  return { blocks };
}

/** Number of textblocks ProseMirror will address, in document order, nested content included. */
export function textblockCount(doc: PMNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.isTextblock) {
      count += 1;
      return false;
    }
    return true;
  });
  return count;
}
