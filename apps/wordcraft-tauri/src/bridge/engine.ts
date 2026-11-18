import { invoke } from "@tauri-apps/api/core";

/** One engine command, exactly as `wordcraft-engine`'s registry describes it. */
export interface CommandSpec {
  id: string;
  label: string;
  /** Ribbon/menu placement: `"Home › Font"`, `"Insert › Tables"`, `"File"`. */
  location: string;
  /** Portable default shortcut: `"Mod+B"`, `"Mod+Shift+>"`, `"F7"`. `Mod` is Ctrl, or ⌘ on macOS. */
  shortcut: string;
  params: string;
  mutates: boolean;
}

/** What the status bar, the title and the page list read. */
export interface DocumentState {
  title: string;
  path: string | null;
  dirty: boolean;
  pageCount: number;
  status: string;
}

/** Every command the engine knows. The ribbon and the keyboard map are built from this. */
export const getCatalog = () => invoke<CommandSpec[]>("engine_catalog");

/** Run one command by id. Every user-visible action goes through here. */
export const runCommand = (id: string, params: Record<string, unknown> = {}) =>
  invoke<unknown>("engine_run", { id, params });

/** Document summary for the shell chrome. */
export const getState = () => invoke<DocumentState>("engine_state");

/** One laid-out page as a base64 PNG. */
export const renderPage = (index: number, scale: number, dark: boolean) =>
  invoke<string>("engine_render_page", { index, scale, dark });

/** True when the page is running inside Tauri rather than a plain browser tab. */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
