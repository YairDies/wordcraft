/**
 * Runs the real import chain outside the browser: parseDOCX -> normalize -> ProseMirror schema.
 * If this prints the document's text, opening a .docx in the app cannot silently produce an
 * empty or broken editor. Run with:
 *   pnpm exec esbuild scripts/verify-docx-import.ts --bundle --platform=node --format=esm --outfile=.verify.mjs
 *   node .verify.mjs samples/welcome.docx
 */
import { readFileSync } from "node:fs";
import { parseDOCX } from "@docen/import-docx";
import { normalizeDocxJson } from "../src/editor/normalize";
import { wordcraftSchema } from "../src/editor/schema";

const path = process.argv[2];
if (!path) {
  console.error("usage: node .verify.mjs <file.docx>");
  process.exit(2);
}

const bytes = new Uint8Array(readFileSync(path));
const raw = await parseDOCX(bytes);
const { doc, dropped } = normalizeDocxJson(raw, wordcraftSchema);

const counts = new Map<string, number>();
doc.descendants((node) => {
  if (node.isBlock) counts.set(node.type.name, (counts.get(node.type.name) ?? 0) + 1);
  return true;
});

console.log("BLOCKS:", doc.childCount);
console.log("NODE TYPES:", [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(", "));
console.log("DROPPED:", dropped.length ? dropped.join(", ") : "none");
console.log("MARKS:", (() => {
  const names = new Set<string>();
  doc.descendants((node) => {
    for (const mark of node.marks) names.add(mark.type.name);
    return true;
  });
  return [...names].sort().join(", ") || "none";
})());
console.log("---TEXT---");
console.log(doc.textContent.trim().slice(0, 1200));
