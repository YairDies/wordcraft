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
import { blockRuns, runsToFragment, sameRuns } from "./runs";
import { documentBlocks, translateTransaction } from "./translate";

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

/**
 * Word's editing keys, bound on the surface. Undo/redo are intentionally absent: the engine owns
 * the document and its history, so undoing in ProseMirror would fork the two models.
 */
function buildPlugins() {
  return [
    tableEditing(),
    keymap({
      "Mod-b": toggleMark(wordcraftSchema.marks.bold),
      "Mod-i": toggleMark(wordcraftSchema.marks.italic),
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

/** Round-trip samples, exposed for measurement. */
declare global {
  interface Window {
    __wcSyncSamples?: { roundTripMs: number; engineMs: number; ops: number }[];
  }
}

export function DocxEditor({ apiRef, onUnsupported, onSynced }: DocxEditorProps) {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const plugins = useMemo(buildPlugins, []);
  const pending = useRef<SyncOp[]>([]);
  const scheduled = useRef(false);
  const syncing = useRef(false);

  const [state, setState] = useState<EditorState>(() =>
    EditorState.create({
      schema: wordcraftSchema,
      plugins,
      doc: wordcraftSchema.node("doc", null, [wordcraftSchema.node("paragraph")]),
    }),
  );

  /**
   * Push the engine's answer into the view. Only blocks whose content actually differs are
   * rewritten, and the transaction is tagged so the dispatcher does not send it straight back.
   */
  const reconcile = useCallback((blocks: BlockOut[]) => {
    const view = apiRef.current.view;
    if (!view) return;
    let tr = view.state.tr;
    let changed = false;
    for (const block of blocks) {
      const index = block.index;
      if (index >= view.state.doc.childCount) continue;
      const current = blockRuns(view.state.doc, index);
      if (!current || sameRuns(current, block.runs)) continue;
      let pos = 0;
      for (let i = 0; i < index; i += 1) pos += view.state.doc.child(i).nodeSize;
      const node = view.state.doc.child(index);
      const contentStart = pos + 1;
      const contentEnd = pos + node.nodeSize - 1;
      tr = tr.replaceWith(contentStart, contentEnd, runsToFragment(block.runs));
      changed = true;
    }
    if (!changed) return;
    tr.setMeta("engineSync", true);
    try {
      view.dispatch(tr);
    } catch (problem) {
      // A correction that cannot be applied must not take the editor down with it; the next
      // resynchronisation starts from the engine's projection anyway.
      onUnsupported?.(`the engine's correction could not be applied: ${String(problem)}`);
    }
  }, [apiRef, onUnsupported]);

  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Re-read the engine once the typing burst has settled, so engine-side rewrites (AutoCorrect)
   *  reach the view without ever racing the characters still in flight. */
  const scheduleSnapshot = useCallback(() => {
    if (snapshotTimer.current) clearTimeout(snapshotTimer.current);
    snapshotTimer.current = setTimeout(() => {
      snapshotTimer.current = null;
      if (!isTauri()) return;
      void syncSnapshot()
        .then((snapshot) => reconcile(snapshot.blocks))
        .catch((problem) => onUnsupported?.(String(problem)));
    }, 140);
  }, [reconcile, onUnsupported]);

  const flush = useCallback(async () => {
    scheduled.current = false;
    if (syncing.current) return;
    const ops = pending.current;
    pending.current = [];
    if (!ops.length) return;
    syncing.current = true;
    const started = performance.now();
    try {
      const delta = await syncApply(ops);
      const roundTripMs = performance.now() - started;
      const sample = { roundTripMs, engineMs: delta.micros / 1000, ops: ops.length };
      window.__wcSyncSamples = window.__wcSyncSamples ?? [];
      window.__wcSyncSamples.push(sample);
      onSynced?.(sample);
    } catch (problem) {
      onUnsupported?.(String(problem));
    } finally {
      syncing.current = false;
      if (pending.current.length && !scheduled.current) {
        scheduled.current = true;
        queueMicrotask(() => void flush());
      } else if (!pending.current.length) {
        // Only when the burst is over. Correcting the view mid-burst would rewrite the block
        // with an engine projection that lacks the characters still queued, deleting them and
        // shifting every following offset — which is exactly how typed text used to arrive
        // scrambled.
        scheduleSnapshot();
      }
    }
  }, [onSynced, onUnsupported, scheduleSnapshot]);

  const enqueue = useCallback(
    (ops: SyncOp[]) => {
      pending.current.push(...ops);
      // A keystroke cancels any pending reconciliation: the queue is briefly empty between two
      // keys, and reconciling then would rewrite the block from an engine projection that is
      // still a character or two behind, deleting what was just typed and shifting every
      // following offset. That is what scrambled typed text into "escribpido".
      if (snapshotTimer.current) {
        clearTimeout(snapshotTimer.current);
        snapshotTimer.current = null;
      }
      if (scheduled.current) return;
      scheduled.current = true;
      // A microtask batches every step produced inside one input event (typing, paste, a
      // multi-step command) into a single engine round trip.
      queueMicrotask(() => void flush());
    },
    [flush],
  );

  const dispatchTransaction = useCallback(
    function (this: EditorView, tr: Transaction) {
      // The engine's own correction coming back: apply it, never bounce it out again.
      if (tr.getMeta("engineSync")) {
        setState((current) => current.apply(tr));
        return;
      }
      if (!isTauri()) {
        setState((current) => current.apply(tr));
        return;
      }
      const { ops, unsupported } = translateTransaction(tr);
      if (unsupported) {
        // Refuse rather than drift: the engine is the authority, and an edit it cannot express
        // must not exist only in the view.
        onUnsupported?.(unsupported);
        return;
      }
      setState((current) => current.apply(tr));
      if (ops.length) enqueue(ops);
    },
    [enqueue, onUnsupported],
  );

  useEffect(() => {
    apiRef.current.loadDocument = (json: unknown) => {
      const { doc } = normalizeDocxJson(json, wordcraftSchema);
      setState(EditorState.create({ schema: wordcraftSchema, doc, plugins, selection: Selection.atStart(doc) }));
      // Seed the engine with the document's blocks; from here the engine owns the text.
      if (!isTauri()) return;
      void syncLoad(documentBlocks(doc)).catch((problem) => onUnsupported?.(String(problem)));
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
    <ProseMirror mount={mount} state={state} dispatchTransaction={dispatchTransaction} attributes={editorAttributes}>
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
