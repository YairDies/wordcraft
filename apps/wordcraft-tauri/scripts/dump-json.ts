import { readFileSync } from "node:fs";
import { parseDOCX } from "@docen/import-docx";

const raw = (await parseDOCX(new Uint8Array(readFileSync(process.argv[2])))) as unknown as {
  content?: Array<Record<string, unknown>>;
};
const hits = (raw.content ?? []).filter((n) => JSON.stringify(n).includes("heading hierarchy") || JSON.stringify(n).includes("numbered step"));
console.log(JSON.stringify(hits, null, 2).slice(0, 2500));
console.log("--- first 3 block shapes ---");
console.log(JSON.stringify((raw.content ?? []).slice(0, 3), null, 2).slice(0, 1200));
