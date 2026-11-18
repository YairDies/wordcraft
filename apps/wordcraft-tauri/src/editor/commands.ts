import { toggleMark } from "prosemirror-commands";
import { wrapInList } from "prosemirror-schema-list";
import type { EditorView } from "prosemirror-view";
import { wordcraftSchema } from "./schema";

type EditorCommand = (view: EditorView) => boolean;

/** A 3×3 table of empty cells, the shape Word offers by default. */
function insertTable(view: EditorView): boolean {
  const { nodes } = wordcraftSchema;
  // prosemirror-tables names its nodes table_row / table_cell; the schema keeps those names
  // because their content expressions refer to each other by name.
  const cellType = nodes.table_cell;
  const rowType = nodes.table_row;
  const tableType = nodes.table;
  const paragraph = nodes.paragraph;
  if (!tableType || !rowType || !cellType || !paragraph) return false;
  const cell = () => cellType.create(null, paragraph.create());
  const row = () => rowType.create(null, [cell(), cell(), cell()]);
  const table = tableType.create(null, [row(), row(), row()]);
  view.dispatch(view.state.tr.replaceSelectionWith(table).scrollIntoView());
  return true;
}

function bulletList(view: EditorView): boolean {
  const type = wordcraftSchema.nodes.bulletList;
  return type ? wrapInList(type)(view.state, view.dispatch) : false;
}

function orderedList(view: EditorView): boolean {
  const type = wordcraftSchema.nodes.orderedList;
  return type ? wrapInList(type)(view.state, view.dispatch) : false;
}

/**
 * Engine commands the editing surface answers itself — and only those the bridge can synchronise.
 * Each produces a transaction the translator turns into engine operations, or a structural change
 * that makes the engine re-seed from the view.
 *
 * Everything else still goes to the engine; the shell resynchronises the view afterwards.
 */
const editorCommands: Record<string, EditorCommand> = {
  "format.bold": (view) => toggleMark(wordcraftSchema.marks.bold)(view.state, view.dispatch),
  "format.italic": (view) => toggleMark(wordcraftSchema.marks.italic)(view.state, view.dispatch),
  "format.underline": (view) => toggleMark(wordcraftSchema.marks.underline)(view.state, view.dispatch),
  "format.strikethrough": (view) => toggleMark(wordcraftSchema.marks.strike)(view.state, view.dispatch),
  "insert.table": insertTable,
  "para.bullets": bulletList,
  "para.numbering": orderedList,
  "text.newParagraph": (view) => {
    // Enter goes through the keymap normally; from the ribbon it splits at the caret.
    view.dispatch(view.state.tr.split(view.state.selection.from).scrollIntoView());
    return true;
  },
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
