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
  }
}

/**
 * The editing surface.
 *
 * React never owns the editor state here: ProseMirror is mounted **uncontrolled**, so a keystroke
 * updates the view directly instead of re-rendering React. That matters for the bridge, because
 * the engine's answer arrives asynchronously and used to wait behind a React render — which is
 * where the 16 ms confirmation went, not in Rust or the IPC.
 */
export function DocxEditor({ apiRef, onUnsupported, onSynced }: DocxEditorProps) {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const plugins = useMemo(buildPlugins, []);
  const pending = useRef<SyncOp[]>([]);
  const scheduled = useRef(false);
  const syncing = useRef(false);
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Coalesces structural edits: the engine is rebuilt once the burst settles. */
  const reseedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reseeding = useRef(false);
  /** Bumped on every edit, so a rebuild that raced new typing can notice and repeat. */
  const docRevision = useRef(0);
  /** Engine path for each ProseMirror textblock ordinal, in document order. */
  const paths = useRef<number[][]>([]);

  const [initialState] = useState(() =>
    EditorState.create({
      schema: wordcraftSchema,
      plugins,
      doc: wordcraftSchema.node("doc", null, [wordcraftSchema.node("paragraph")]),
    }),
  );

  /** Push the engine's projection into the view, block by block, only where it differs. */
  const reconcile = useCallback(
    (blocks: BlockOut[]) => {
      const view = apiRef.current.view;
      if (!view) return;
      const ordinalOf = new Map<string, number>();
      paths.current.forEach((path, ordinal) => ordinalOf.set(pathKey(path), ordinal));

      let tr = view.state.tr;
      let changed = false;
      for (const block of blocks) {
        const ordinal = ordinalOf.get(pathKey(block.path));
        if (ordinal === undefined) continue;
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
   * Rebuild the engine's document from the editor's own, then re-map every block path.
   *
   * Typing does not stop while this is in flight, so the rebuild repeats until the document has
   * not changed since the seed was taken. Without that, edits made during the round trip were sent
   * against an engine that was about to be replaced, and the replacement deleted them — typed
   * text came back as "SEUNDO".
   */
  const reseed = useCallback(async () => {
    if (reseeding.current) return;
    const view = apiRef.current.view;
    if (!view || !isTauri()) return;
    reseeding.current = true;
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const view = apiRef.current.view;
        if (!view) return;
        const revision = docRevision.current;
        const { blocks, problem } = buildSeed(view.state.doc);
        if (problem) {
          onUnsupported?.(`the engine cannot hold this document yet: ${problem}`);
          return;
        }
        const projection = await syncLoad(blocks);
        const expected = textblockCount(view.state.doc);
        if (projection.blocks.length !== expected) {
          onUnsupported?.(`the engine built ${projection.blocks.length} paragraphs for ${expected} blocks`);
          return;
        }
        paths.current = projection.blocks.map((block) => block.path);
        reconcile(projection.blocks);
        if (docRevision.current === revision) return;
      }
    } catch (problem) {
      onUnsupported?.(String(problem));
    } finally {
      reseeding.current = false;
    }
  }, [apiRef, reconcile, onUnsupported]);

  const scheduleReseed = useCallback(() => {
    if (reseedTimer.current) clearTimeout(reseedTimer.current);
    reseedTimer.current = setTimeout(() => {
      reseedTimer.current = null;
      void reseed();
    }, 80);
  }, [reseed]);

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
      onSynced?.({ roundTripMs: performance.now() - started, engineMs: delta.micros / 1000, ops: ops.length });
      window.__wcSyncSamples = window.__wcSyncSamples ?? [];
      window.__wcSyncSamples.push({ roundTripMs: performance.now() - started, engineMs: delta.micros / 1000, ops: ops.length });
    } catch (problem) {
      onUnsupported?.(String(problem));
    } finally {
      syncing.current = false;
      if (pending.current.length && !scheduled.current) {
        scheduled.current = true;
        queueMicrotask(() => void flush());
      } else if (!pending.current.length) {
        // Only when the burst is over: correcting the view mid-burst would rewrite the block
        // with a projection that lacks the characters still queued, deleting them and shifting
        // every following offset.
        scheduleSnapshot();
      }
    }
  }, [onSynced, onUnsupported, scheduleSnapshot]);

  const enqueue = useCallback(
    (ops: SyncOp[]) => {
      // While a rebuild is pending or running the engine is about to be replaced; sending
      // operations now would apply them to the outgoing document. The rebuild captures whatever
      // was typed in the meantime.
      if (reseeding.current || reseedTimer.current) return;
      pending.current.push(...ops);
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
      // The engine's own correction coming back: apply it, never bounce it out again.
      if (tr.getMeta("engineSync")) {
        view.updateState(view.state.apply(tr));
        return;
      }
      if (!isTauri()) {
        view.updateState(view.state.apply(tr));
        return;
      }
      docRevision.current += 1;
      const { ops, structural } = translateTransaction(tr, paths.current);
      view.updateState(view.state.apply(tr));
      if (structural) {
        // Enter, a joined paragraph, a new list or table: the engine is rebuilt from what the
        // view now holds, so its copy stays complete instead of drifting.
        pending.current = [];
        scheduleReseed();
        return;
      }
      if (ops.length) enqueue(ops);
    },
    [enqueue, scheduleReseed],
  );

  useEffect(() => {
    apiRef.current.loadDocument = (json: unknown) => {
      const view = apiRef.current.view;
      if (!view) return;
      const { doc } = normalizeDocxJson(json, wordcraftSchema);
      view.updateState(EditorState.create({ schema: wordcraftSchema, doc, plugins, selection: Selection.atStart(doc) }));
      paths.current = [];
      void reseed();
    };
    apiRef.current.focus = () => apiRef.current.view?.focus();
    apiRef.current.resync = () => {
      if (!isTauri()) return;
      void syncSnapshot()
        .then((snapshot) => reconcile(snapshot.blocks))
        .catch((problem) => onUnsupported?.(String(problem)));
    };
  }, [apiRef, plugins, reconcile, reseed, onUnsupported]);

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
