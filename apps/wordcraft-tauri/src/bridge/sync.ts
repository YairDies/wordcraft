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

export type SyncOp =
  | { op: "InsertText"; path: number[]; offset: number; text: string }
  | { op: "DeleteRange"; from_path: number[]; from_offset: number; to_path: number[]; to_offset: number }
  | { op: "SetMark"; path: number[]; from: number; to: number; mark: MarkName; on: boolean };

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

export interface SyncDelta {
  blocks: BlockOut[];
  micros: number;
}

/** Seed the canonical document from the blocks the front end describes. */
export const syncLoad = (blocks: SeedBlock[]) => invoke<Projection>("sync_load", { blocks });

/** Apply a batch of edits; the answer carries only the blocks that changed. */
export const syncApply = (ops: SyncOp[]) => invoke<SyncDelta>("sync_apply", { ops });

/** The engine's whole projection, for correcting the view after an engine-only command. */
export const syncSnapshot = () => invoke<Projection>("sync_snapshot", {});
