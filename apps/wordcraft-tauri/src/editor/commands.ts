import { toggleMark } from "prosemirror-commands";
import type { EditorView } from "prosemirror-view";
import { wordcraftSchema } from "./schema";

type EditorCommand = (view: EditorView) => boolean;

/**
 * Engine commands the editing surface answers itself — and only those the bridge knows how to
 * synchronise. Each produces a transaction the translator can turn into engine operations.
 *
 * Everything else (underline, strike, undo, alignment, tables...) still goes to the engine; the
 * shell resynchronises the view afterwards rather than applying it locally, so the two models
 * never disagree.
 */
const editorCommands: Record<string, EditorCommand> = {
  "format.bold": (view) => toggleMark(wordcraftSchema.marks.bold)(view.state, view.dispatch),
  "format.italic": (view) => toggleMark(wordcraftSchema.marks.italic)(view.state, view.dispatch),
};

/** True when the editor handled the command, so the caller must not also send it to the engine. */
export function applyEditorCommand(id: string, view: EditorView | null): boolean {
  if (!view) return false;
  const command = editorCommands[id];
  if (!command) return false;
  const handled = command(view);
  view.focus();
  return handled;
}
