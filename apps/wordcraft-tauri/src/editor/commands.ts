import { toggleMark } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import type { EditorView } from "prosemirror-view";
import { wordcraftSchema } from "./schema";

type EditorCommand = (view: EditorView) => boolean;

/**
 * Engine command ids that the editing surface answers itself. Everything else still goes to the
 * Rust engine. As the two sides grow together, entries move here deliberately, one at a time.
 */
const editorCommands: Record<string, EditorCommand> = {
  "format.bold": (view) => toggleMark(wordcraftSchema.marks.bold)(view.state, view.dispatch),
  "format.italic": (view) => toggleMark(wordcraftSchema.marks.italic)(view.state, view.dispatch),
  "format.underline": (view) => toggleMark(wordcraftSchema.marks.underline)(view.state, view.dispatch),
  "format.strikethrough": (view) => toggleMark(wordcraftSchema.marks.strike)(view.state, view.dispatch),
  "format.superscript": (view) => toggleMark(wordcraftSchema.marks.superscript)(view.state, view.dispatch),
  "format.subscript": (view) => toggleMark(wordcraftSchema.marks.subscript)(view.state, view.dispatch),
  "edit.undo": (view) => undo(view.state, view.dispatch),
  "edit.redo": (view) => redo(view.state, view.dispatch),
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

/** Whether a command is answered by the editing surface rather than the engine. */
export function isEditorCommand(id: string): boolean {
  return id in editorCommands;
}
