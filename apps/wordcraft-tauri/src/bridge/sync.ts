import { invoke } from "@tauri-apps/api/core";

/**
 * The wire protocol with the Rust engine. Field names are snake_case because the Rust side
 * defines them that way; this module is the single place that knows it.
 *
 * Blocks are addressed by the engine's own **path**: `[3]` is the fourth top-level paragraph,
 * `[2, 0, 1, 0]` the paragraph in row 0, cell 1, of the table at block 2. That is what lets list
 * items and table cells be engine-owned instead of empty placeholders.
 *
 * Offsets are UTF-16 code units — what ProseMirror and JavaScript count. The engine converts to
 * UTF-8 bytes on its side.
 */
export type MarkName = "bold" | "italic" | "underline" | "strike";

export type SeedBlock =
  | { kind: "para"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; rows: string[][] };

/**
 * Engine operations. Text operations carry **no position**: the engine keeps the cursor between
 * calls and acts where it is, as Word's document object does. Only the operations that move the
 * cursor name a place, and those are issued when the person clicks or moves, not when they type.
 */
export type SyncOp =
  | { op: "CursorMove"; path: number[]; offset: number }
  | { op: "SelectRange"; from_path: number[]; from_offset: number; to_path: number[]; to_offset: number }
  | { op: "InsertText"; text: string }
  | { op: "DeleteBack" }
  | { op: "DeleteForward" }
  | { op: "DeleteSelection" }
  | { op: "SplitBlock" }
  | { op: "SetMark"; mark: MarkName; on: boolean };

/** Where the engine's cursor is: the only position that cannot go stale. */
export interface EngineCursor {
  path: number[];
  offset: number;
}

export interface RunOut {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

export interface BlockOut {
  path: number[];
  runs: RunOut[];
}

export interface Projection {
  blocks: BlockOut[];
  micros: number;
}

/** The document as a tree: what the view needs to be rebuilt after a structural change. */
export type ProjectedBlock =
  | { kind: "para"; runs: RunOut[] }
  | { kind: "heading"; level: number; runs: RunOut[] }
  | { kind: "list"; ordered: boolean; items: RunOut[][] }
  | { kind: "table"; rows: RunOut[][][][] };

export interface SyncDelta {
  blocks: BlockOut[];
  micros: number;
  /** The engine's cursor after the batch. */
  caret?: EngineCursor;
  /** Present when the edit was structural: the whole document, its block paths and the caret. */
  structure?: ProjectedBlock[];
  paths?: number[][];
}

/** Seed the canonical document from the blocks the front end describes. */
export const syncLoad = (blocks: SeedBlock[]) => invoke<Projection>("sync_load", { blocks });

/**
 * Apply a batch of edits. A content edit answers with only the blocks that changed; a structural
 * one answers with the whole document, so the view is rebuilt from the engine in the same reply.
 */
export const syncApply = (ops: SyncOp[], structural = false) => invoke<SyncDelta>("sync_apply", { ops, structural });

/** The engine's whole projection, for correcting the view after an engine-only command. */
export const syncSnapshot = () => invoke<Projection>("sync_snapshot", {});
