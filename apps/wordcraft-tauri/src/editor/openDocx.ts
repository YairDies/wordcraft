import { parseDOCX } from "@docen/import-docx";
import type { Schema } from "prosemirror-model";
import { normalizeDocxJson } from "./normalize";

export interface ImportedDocument {
  json: Record<string, unknown>;
  dropped: string[];
  name: string;
}

/**
 * Read a .docx the person picked and turn it into ProseMirror JSON our schema understands.
 * `parseDOCX` runs entirely in the browser (fflate + XML parsing); its `@napi-rs/canvas` peer is
 * only used for image cropping under Node, so nothing native is pulled into the app.
 */
export async function importDocxFile(file: File, schema: Schema): Promise<ImportedDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const json = (await parseDOCX(bytes)) as unknown as Record<string, unknown>;
  const { dropped } = normalizeDocxJson(json, schema);
  return { json, dropped, name: file.name };
}
