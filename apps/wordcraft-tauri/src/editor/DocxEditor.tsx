import { useCallback, useEffect, useMemo, useState } from "react";
import { ProseMirror, useEditorEffect } from "@nytimes/react-prosemirror";
import { EditorState, Selection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { history, redo, undo } from "prosemirror-history";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { tableEditing } from "prosemirror-tables";
import { wordcraftSchema } from "./schema";
import { normalizeDocxJson } from "./normalize";

/** What the surrounding shell can do to the editor. Held in a ref so it never forces a re-render. */
export interface EditorApi {
  view: EditorView | null;
  loadDocument: (json: unknown) => void;
  focus: () => void;
}

interface DocxEditorProps {
  apiRef: { current: EditorApi };
  onSelectionChange?: (state: EditorState) => void;
}

/**
 * Word's editing keys, bound on the surface itself so they win over the shell's global handler.
 * `Mod` is Ctrl, or ⌘ on macOS, matching the engine's own shortcut notation.
 */
function buildPlugins() {
  return [
    history(),
    tableEditing(),
    keymap({
      "Mod-b": toggleMark(wordcraftSchema.marks.bold),
      "Mod-i": toggleMark(wordcraftSchema.marks.italic),
      "Mod-u": toggleMark(wordcraftSchema.marks.underline),
      "Mod-z": undo,
      "Mod-y": redo,
      "Shift-Mod-z": redo,
    }),
    keymap(baseKeymap),
  ];
}

/**
 * The attributes ProseMirror puts on the element it makes editable. `role="textbox"` with
 * `aria-multiline` is what makes NVDA and Narrator announce a real editable document instead of
 * an anonymous group; `aria-label` names it. This is the whole accessibility argument for a DOM
 * editor over a canvas, so these are not optional decoration.
 */
const editorAttributes: Record<string, string> = {
  class: "wc-prose",
  role: "textbox",
  "aria-multiline": "true",
  "aria-label": "Document text",
  "aria-describedby": "wc-editor-hint",
  spellcheck: "true",
  tabindex: "0",
};

export function DocxEditor({ apiRef, onSelectionChange }: DocxEditorProps) {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const plugins = useMemo(buildPlugins, []);

  const [state, setState] = useState<EditorState>(() =>
    EditorState.create({
      schema: wordcraftSchema,
      plugins,
      // A new document starts with one empty paragraph, as Word does.
      doc: wordcraftSchema.node("doc", null, [wordcraftSchema.node("paragraph")]),
    }),
  );

  const dispatchTransaction = useCallback(function (this: EditorView, tr: Transaction) {
    setState((current) => current.apply(tr));
  }, []);

  useEffect(() => {
    apiRef.current.loadDocument = (json: unknown) => {
      const { doc } = normalizeDocxJson(json, wordcraftSchema);
      setState(EditorState.create({ schema: wordcraftSchema, doc, plugins, selection: Selection.atStart(doc) }));
    };
    apiRef.current.focus = () => apiRef.current.view?.focus();
  }, [apiRef, plugins]);

  useEffect(() => {
    onSelectionChange?.(state);
  }, [state, onSelectionChange]);

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
