import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProseMirror, useEditorEffect } from "@nytimes/react-prosemirror";
import { EditorState, Selection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { tableEditing } from "prosemirror-tables";
import { syncApply, syncLoad, syncSnapshot } from "../bridge/sync";
import type { BlockOut, SyncOp } from "../bridge/sync";
import { isTauri } from "../bridge/engine";
import { wordcraftSchema } from "./schema";
import { normalizeDocxJson } from "./normalize";
import { blockAt, pathKey } from "./blocks";
import { blockRuns, runsToFragment, sameRuns } from "./runs";
import { buildSeed, textblockCount } from "./seed";
import { translateTransaction } from "./translate";

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
  onUnsupported?: (reason: string) => void;
  onSynced?: (sample: { roundTripMs: number; engineMs: number; ops: number }) => void;
}

function buildPlugins() {
  return [
    tableEditing(),
    keymap({
      "Mod-b": toggleMark(wordcraftSchema.marks.bold),
      "Mod-i": toggleMark(wordcraftSchema.marks.italic),
      "Mod-u": toggleMark(wordcraftSchema.marks.underline),
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
export function DocxEditor({ apiRef, onUnsupported, onSynced }: DocxEditorProps) {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const plugins = useMemo(buildPlugins, []);
  const pending = useRef<SyncOp[]>([]);
  const pendingStructural = useRef(false);
  const scheduled = useRef(false);
  const syncing = useRef(false);
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Engine path for each ProseMirror textblock ordinal, in document order. */
  const paths = useRef<number[][]>([]);

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

  /** Re-read the engine's block paths and projection. Structure moved, the document did not. */
  const refreshPaths = useCallback(async () => {
    const view = apiRef.current.view;
    if (!view || !isTauri()) return;
    try {
      const snapshot = await syncSnapshot();
      if (snapshot.blocks.length !== textblockCount(view.state.doc)) {
        onUnsupported?.(`the engine has ${snapshot.blocks.length} paragraphs, the view ${textblockCount(view.state.doc)}`);
        return;
      }
      paths.current = snapshot.blocks.map((block) => block.path);
      reconcile(snapshot.blocks);
    } catch (problem) {
      onUnsupported?.(String(problem));
    }
  }, [apiRef, reconcile, onUnsupported]);

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

  const flush = useCallback(async () => {
    scheduled.current = false;
    if (syncing.current) return;
    const ops = pending.current;
    const structural = pendingStructural.current;
    pending.current = [];
    pendingStructural.current = false;
    if (!ops.length) return;
    syncing.current = true;
    const started = performance.now();
    try {
      const delta = await syncApply(ops);
      onSynced?.({ roundTripMs: performance.now() - started, engineMs: delta.micros / 1000, ops: ops.length });
      window.__wcSyncSamples = window.__wcSyncSamples ?? [];
      window.__wcSyncSamples.push({ roundTripMs: performance.now() - started, engineMs: delta.micros / 1000, ops: ops.length });
      // A structural operation renumbers the blocks, so the paths are re-read from the engine
      // rather than the document being rebuilt.
      if (structural) await refreshPaths();
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
  }, [onSynced, onUnsupported, refreshPaths, scheduleSnapshot]);

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
      const { ops, structural, unsupported } = translateTransaction(tr, paths.current);
      if (unsupported) {
        // The engine is the authority: an edit it cannot express must not exist only in the view.
        onUnsupported?.(unsupported);
        return;
      }
      view.updateState(view.state.apply(tr));
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
      <ViewBridge apiRef={apiRef} />
    </ProseMirror>
  );
}

/** Keeps the shell's copy of the EditorView current without triggering a render loop. */
function ViewBridge({ apiRef }: { apiRef: { current: EditorApi } }) {
  useEditorEffect((view) => {
    apiRef.current.view = view;
  });
  return null;
}
