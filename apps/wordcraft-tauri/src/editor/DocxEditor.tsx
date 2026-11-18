import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProseMirror, useEditorEffect } from "@nytimes/react-prosemirror";
import { EditorState, Selection, TextSelection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { tableEditing } from "prosemirror-tables";
import { syncApply, syncLoad, syncSnapshot } from "../bridge/sync";
import type { BlockOut, EngineCursor, ProjectedBlock, SyncOp } from "../bridge/sync";
import { isTauri } from "../bridge/engine";
import { wordcraftSchema } from "./schema";
import { normalizeDocxJson } from "./normalize";
import { blockAt, pathKey } from "./blocks";
import { blockRuns, runsToFragment, sameRuns } from "./runs";
import { buildSeed, textblockCount } from "./seed";
import { structureToDoc } from "./serialize";
import { translateTransaction } from "./translate";
import { activeCommands } from "./active";

/** What the surrounding shell can do to the editor. Held in a ref so it never forces a render. */
export interface EditorApi {
  view: EditorView | null;
  loadDocument: (json: unknown) => void;
  focus: () => void;
  /** Re-read the engine's whole document and correct the view. */
  resync: () => void;
}

interface DocxEditorProps {
  apiRef: { current: EditorApi };
  /** Resolves a command id to the accelerator in force for the current language and preferences. */
  resolveShortcut: (id: string) => string;
  /** Reports which formatting commands are on at the caret, for the ribbon's filled icons. */
  onActiveChange?: (active: string[]) => void;
  onUnsupported?: (reason: string) => void;
  onSynced?: (sample: { roundTripMs: number; engineMs: number; ops: number }) => void;
}

/**
 * The editor's keymap comes from the same shortcut map as the ribbon and the shell, so a Spanish
 * interface really does get Ctrl+N for bold: the key is the mnemonic of the word.
 */
function buildPlugins(resolve: (id: string) => string) {
  const bind = (id: string, mark: "bold" | "italic" | "underline") => {
    const accelerator = resolve(id);
    if (!accelerator) return {};
    const spec = accelerator
      .split("+")
      .map((part) => {
        const p = part.trim();
        if (p === "Mod" || p === "Ctrl" || p === "Alt" || p === "Shift") return p;
        return p.length === 1 ? p.toLowerCase() : p;
      })
      .join("-");
    return { [spec]: toggleMark(wordcraftSchema.marks[mark]) };
  };
  return [
    tableEditing(),
    keymap({
      ...bind("format.bold", "bold"),
      ...bind("format.italic", "italic"),
      ...bind("format.underline", "underline"),
    }),
    keymap(baseKeymap),
  ];
}

const editorAttributes: Record<string, string> = {
  class: "wc-prose",
  role: "textbox",
  "aria-multiline": "true",
  "aria-label": "Document text",
  "aria-describedby": "wc-editor-hint",
  spellcheck: "true",
  tabindex: "0",
};

declare global {
  interface Window {
    __wcSyncSamples?: { roundTripMs: number; engineMs: number; ops: number }[];
    /** Diagnostic switch: disconnects the editor from the engine so the view can be observed. */
    __wcDisableSync?: boolean;
  }
}

const syncDisabled = (): boolean => typeof window !== "undefined" && window.__wcDisableSync === true;

/**
 * The editing surface.
 *
 * ProseMirror is mounted **uncontrolled**: React never holds the editor state, so a keystroke
 * updates the view directly. The engine owns the document; the view is its projection.
 *
 * Structural edits are engine operations now — Enter becomes `SplitBlock`, and deleting across
 * paragraphs becomes a `DeleteRange` that the engine turns into a join. Nothing re-seeds the
 * document, so the engine keeps its undo and the view is never rebuilt underneath the typing.
 */
export function DocxEditor({ apiRef, resolveShortcut, onActiveChange, onUnsupported, onSynced }: DocxEditorProps) {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const plugins = useMemo(() => buildPlugins(resolveShortcut), [resolveShortcut]);
  const pending = useRef<SyncOp[]>([]);
  const pendingStructural = useRef(false);
  const scheduled = useRef(false);
  const syncing = useRef(false);
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Local edits made while a structural operation is in flight, waiting to be rebased onto it. */
  const deferred = useRef<Transaction[]>([]);
  const structuralInFlight = useRef(false);
  /** Set after `enqueue` exists: replay and flush reference each other and form a cycle. */
  const enqueueRef = useRef<(ops: SyncOp[], structural: boolean) => void>(() => {});
  /** Engine path for each ProseMirror textblock ordinal, in document order. */
  const paths = useRef<number[][]>([]);
  /** Where the engine says its cursor is. The only position that cannot go stale. */
  const engineCursor = useRef<EngineCursor | null>(null);

  const [initialState] = useState(() =>
    EditorState.create({
      schema: wordcraftSchema,
      plugins,
      doc: wordcraftSchema.node("doc", null, [wordcraftSchema.node("paragraph")]),
    }),
  );

  /** Apply the engine's blocks to the view, block by block, only where they differ. */
  const reconcile = useCallback(
    (blocks: BlockOut[]) => {
      const view = apiRef.current.view;
      if (!view) return;
      const ordinalOf = new Map<string, number>();
      paths.current.forEach((path, ordinal) => ordinalOf.set(pathKey(path), ordinal));

      // Positions come from the current document, so a replacement shifts everything after it.
      // Walking backwards keeps every later position valid.
      const ordered = blocks
        .map((block) => ({ block, ordinal: ordinalOf.get(pathKey(block.path)) }))
        .filter((entry): entry is { block: BlockOut; ordinal: number } => entry.ordinal !== undefined)
        .sort((a, b) => b.ordinal - a.ordinal);

      let tr = view.state.tr;
      let changed = false;
      for (const { block, ordinal } of ordered) {
        const current = blockRuns(view.state.doc, ordinal);
        if (!current || sameRuns(current, block.runs)) continue;
        const target = blockAt(view.state.doc, ordinal);
        if (!target) continue;
        tr = tr.replaceWith(target.start, target.start + target.node.content.size, runsToFragment(block.runs));
        changed = true;
      }
      if (!changed) return;
      tr.setMeta("engineSync", true);
      try {
        view.dispatch(tr);
      } catch (problem) {
        onUnsupported?.(`the engine's correction could not be applied: ${String(problem)}`);
      }
    },
    [apiRef, onUnsupported],
  );

  /**
   * Rebuild the view from the engine's document after a structural edit.
   *
   * The engine has already applied the change to its own document, and its answer carries that
   * document, the new block paths and the caret — all from the same instant. Rebuilding from this
   * reply means the view is never corrected against indices that have already moved.
   */
  const rebuildFromEngine = useCallback(
    (structure: ProjectedBlock[], newPaths: number[][], caret?: { path: number[]; offset: number }) => {
      const view = apiRef.current.view;
      if (!view) return;
      const doc = structureToDoc(structure);
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
      paths.current = newPaths;
      engineCursor.current = caret ?? null;
      if (caret) {
        const ordinal = newPaths.findIndex((path) => pathKey(path) === pathKey(caret.path));
        const target = ordinal >= 0 ? blockAt(tr.doc, ordinal) : null;
        if (target) {
          const inside = Math.min(caret.offset, target.node.content.size);
          tr.setSelection(TextSelection.create(tr.doc, target.start + inside));
        }
      }
      tr.setMeta("engineSync", true);
      view.dispatch(tr);
    },
    [apiRef],
  );

  const scheduleSnapshot = useCallback(() => {
    if (snapshotTimer.current) clearTimeout(snapshotTimer.current);
    snapshotTimer.current = setTimeout(() => {
      snapshotTimer.current = null;
      if (!isTauri() || syncDisabled()) return;
      void syncSnapshot()
        .then((snapshot) => reconcile(snapshot.blocks))
        .catch((problem) => onUnsupported?.(String(problem)));
    }, 140);
  }, [reconcile, onUnsupported]);

  /**
   * Re-applies the edits made while the structural operation was in flight.
   *
   * They were applied to the view optimistically and the engine never saw them, so the rebuild
   * discarded them. Each one is replayed onto the engine's document and translated again against
   * the *new* block paths; a step that no longer fits is dropped rather than thrown.
   */
  const replayDeferred = useCallback(() => {
    const waiting = deferred.current;
    deferred.current = [];
    structuralInFlight.current = false;
    for (const original of waiting) {
      const view = apiRef.current.view;
      if (!view) return;
      // The steps were written against the document that existed before the rebuild, so replaying
      // them is a best effort: a step that no longer fits is dropped rather than thrown.
      let fresh = view.state.tr;
      for (const step of original.steps) {
        try {
          fresh.step(step);
        } catch {
          continue;
        }
      }
      if (!fresh.docChanged) continue;
      view.updateState(view.state.apply(fresh));
      const { ops, structural: becameStructural, unsupported } = translateTransaction(fresh, paths.current, engineCursor.current);
      if (unsupported) {
        onUnsupported?.(unsupported);
        continue;
      }
      if (ops.length) enqueueRef.current(ops, becameStructural === true);
    }
  }, [apiRef, onUnsupported]);

  const flush = useCallback(async () => {
    scheduled.current = false;
    if (syncing.current) return;
    const ops = pending.current;
    const structural = pendingStructural.current;
    pending.current = [];
    pendingStructural.current = false;
    if (!ops.length) return;
    syncing.current = true;
    if (structural) structuralInFlight.current = true;
    const started = performance.now();
    try {
      const delta = await syncApply(ops, structural);
      const roundTripMs = performance.now() - started;
      if (delta.caret) engineCursor.current = delta.caret;
      onSynced?.({ roundTripMs, engineMs: delta.micros / 1000, ops: ops.length });
      window.__wcSyncSamples = window.__wcSyncSamples ?? [];
      window.__wcSyncSamples.push({ roundTripMs, engineMs: delta.micros / 1000, ops: ops.length });
      // A structural change renumbers the blocks, so the view is rebuilt from the engine's answer
      // in this same reply rather than patched against stale indices.
      if (structural && delta.structure && delta.paths) {
        rebuildFromEngine(delta.structure, delta.paths, delta.caret);
        replayDeferred();
      }
    } catch (problem) {
      onUnsupported?.(String(problem));
    } finally {
      syncing.current = false;
      if (pending.current.length && !scheduled.current) {
        scheduled.current = true;
        queueMicrotask(() => void flush());
      } else if (!pending.current.length) {
        // Only when the burst is over: correcting the view mid-burst would rewrite the block
        // with a projection that lacks the characters still queued.
        scheduleSnapshot();
      }
    }
  }, [onSynced, onUnsupported, rebuildFromEngine, replayDeferred, scheduleSnapshot]);

  const enqueue = useCallback(
    (ops: SyncOp[], structural: boolean) => {
      pending.current.push(...ops);
      if (structural) pendingStructural.current = true;
      if (snapshotTimer.current) {
        clearTimeout(snapshotTimer.current);
        snapshotTimer.current = null;
      }
      if (scheduled.current) return;
      scheduled.current = true;
      queueMicrotask(() => void flush());
    },
    [flush],
  );

  useEffect(() => {
    enqueueRef.current = enqueue;
  }, [enqueue]);

  const dispatchTransaction = useCallback(
    function (this: EditorView, tr: Transaction) {
      const view = this;
      if (tr.getMeta("engineSync")) {
        view.updateState(view.state.apply(tr));
        return;
      }
      if (!isTauri() || syncDisabled()) {
        view.updateState(view.state.apply(tr));
        return;
      }
      const { ops, structural, unsupported } = translateTransaction(tr, paths.current, engineCursor.current);
      if (unsupported) {
        // The engine is the authority: an edit it cannot express must not exist only in the view.
        onUnsupported?.(unsupported);
        return;
      }
      view.updateState(view.state.apply(tr));
      if (structuralInFlight.current) {
        // A structural operation is in flight: this edit belongs on top of whatever the engine
        // answers, not on top of indices that are about to move.
        deferred.current.push(tr);
        return;
      }
      if (ops.length) enqueue(ops, structural === true);
    },
    [enqueue, onUnsupported],
  );

  useEffect(() => {
    apiRef.current.loadDocument = (json: unknown) => {
      const view = apiRef.current.view;
      if (!view) return;
      const { doc } = normalizeDocxJson(json, wordcraftSchema);
      // A transaction on the mounted view, not a fresh EditorState handed to updateState: this
      // library renders the document through React and owns the state it renders, so an
      // EditorState built outside it never reached the screen.
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
      tr.setSelection(Selection.atStart(tr.doc));
      tr.setMeta("engineSync", true);
      view.dispatch(tr);
      paths.current = [];
      engineCursor.current = null;
      // The one place the front end seeds the engine: after this the engine owns the text.
      if (!isTauri() || syncDisabled()) return;
      const { blocks, problem } = buildSeed(view.state.doc);
      if (problem) {
        onUnsupported?.(`the engine cannot hold this document yet: ${problem}`);
        return;
      }
      const expected = textblockCount(view.state.doc);
      void syncLoad(blocks)
        .then((projection) => {
          if (projection.blocks.length !== expected) {
            onUnsupported?.(`the engine built ${projection.blocks.length} paragraphs for ${expected} blocks`);
            return;
          }
          paths.current = projection.blocks.map((block) => block.path);
          reconcile(projection.blocks);
        })
        .catch((problem) => onUnsupported?.(String(problem)));
    };
    apiRef.current.focus = () => apiRef.current.view?.focus();
    apiRef.current.resync = () => {
      if (!isTauri()) return;
      void syncSnapshot()
        .then((snapshot) => reconcile(snapshot.blocks))
        .catch((problem) => onUnsupported?.(String(problem)));
    };
  }, [apiRef, plugins, reconcile, onUnsupported]);

  return (
    <ProseMirror mount={mount} defaultState={initialState} dispatchTransaction={dispatchTransaction} attributes={editorAttributes}>
      <div ref={setMount} className="wc-sheet" />
      <ViewBridge apiRef={apiRef} onActiveChange={onActiveChange} />
    </ProseMirror>
  );
}

/**
 * Keeps the shell's copy of the EditorView current, and reports the active formatting.
 *
 * The report is only sent when it actually differs: `useEditorEffect` runs after every editor
 * update, so notifying unconditionally made the parent re-render, which updated the editor, which
 * notified again — React error #185, an infinite update loop.
 */
function ViewBridge({ apiRef, onActiveChange }: { apiRef: { current: EditorApi }; onActiveChange?: (active: string[]) => void }) {
  const lastReported = useRef<string>("");
  useEditorEffect((view) => {
    apiRef.current.view = view;
    if (!view || !onActiveChange) return;
    const active = activeCommands(view.state);
    const signature = [...active].sort().join(",");
    if (signature === lastReported.current) return;
    lastReported.current = signature;
    onActiveChange(active);
  });
  return null;
}
