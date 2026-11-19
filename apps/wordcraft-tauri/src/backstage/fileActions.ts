import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

/**
 * The file actions the Backstage drives.
 *
 * The pickers are the operating system's own, through Tauri's dialog plugin, and the bytes come
 * from the shell's `read_bytes`/`write_text` commands because the webview has no filesystem.
 */

const DOCX_FILTER = [{ name: "Documento de Word", extensions: ["docx"] }];

export interface PickedDocument {
  name: string;
  bytes: Uint8Array;
}

/** Ask for a .docx and read it. `null` when the person cancels. */
export async function pickDocument(): Promise<PickedDocument | null> {
  const selected = await open({ multiple: false, directory: false, filters: DOCX_FILTER });
  if (typeof selected !== "string") return null;
  const bytes = await invoke<number[]>("read_bytes", { path: selected });
  const name = selected.split(/[\\/]/).pop() ?? "document.docx";
  return { name, bytes: new Uint8Array(bytes) };
}

/** Ask where to save, and write the text there. Returns the chosen path, or null when cancelled. */
export async function pickSaveTarget(defaultName: string, contents: string): Promise<string | null> {
  const target = await save({ defaultPath: defaultName, filters: DOCX_FILTER });
  if (typeof target !== "string") return null;
  await invoke<string>("write_text", { path: target, contents });
  return target;
}

/** Ask for a PDF target. The engine writes the PDF; this only chooses where it goes. */
export async function pickPdfTarget(defaultName: string): Promise<string | null> {
  const target = await save({ defaultPath: defaultName, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return typeof target === "string" ? target : null;
}
