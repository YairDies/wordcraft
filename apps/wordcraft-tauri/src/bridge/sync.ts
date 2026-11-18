import { invoke } from "@tauri-apps/api/core";

/**
 * The wire protocol with the Rust engine. Field names are snake_case because the Rust side
 * defines them that way; this module is the single place that knows it.
 *
 * Offsets are UTF-16 code units, which is what ProseMirror and JavaScript count. The engine
 * converts to UTF-8 bytes on its side.
 */
export type SyncOp =
  | { op: "InsertText"; block: number; offset: number; text: string }
  | { op: "DeleteRange"; from_block: number; from_offset: number; to_block: number; to_offset: number }
  | { op: "SetMark"; block: number; from: number; to: number; mark: "bold" | "italic"; on: boolean };

export interface RunOut {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface BlockOut {
  index: number;
  runs: RunOut[];
}

export interface SyncDelta {
  blocks: BlockOut[];
  caret: { block: number; offset: number } | null;
  /** How long the engine took, in microseconds. */
  micros: number;
}

/** Seed the canonical document from the blocks the front end starts with. */
export const syncLoad = (blocks: string[]) => invoke<{ blocks: BlockOut[]; version: number }>("sync_load", { blocks });

/** Apply a batch of edits; the answer carries only the blocks that changed. */
export const syncApply = (ops: SyncOp[]) => invoke<SyncDelta>("sync_apply", { ops });

/** The engine's whole projection, for correcting the view after an engine-only command. */
export const syncSnapshot = () => invoke<{ blocks: BlockOut[]; micros: number }>("sync_snapshot", {});
