import type { EditorState } from "prosemirror-state";

/**
 * Which formatting commands are currently *on*, for the ribbon's filled icons.
 *
 * Read from the view's own state: it is the projection of the engine's document, so it is the
 * cheapest truthful answer, and it updates as the caret moves.
 */
export function activeCommands(state: EditorState): string[] {
  const active: string[] = [];
  const { $from, empty } = state.selection;

  const markOn = (name: string) => {
    const type = state.schema.marks[name];
    if (!type) return false;
    return empty ? Boolean(type.isInSet(state.storedMarks ?? $from.marks())) : state.doc.rangeHasMark(state.selection.from, state.selection.to, type);
  };
  if (markOn("bold")) active.push("format.bold");
  if (markOn("italic")) active.push("format.italic");
  if (markOn("underline")) active.push("format.underline");
  if (markOn("strike")) active.push("format.strikethrough");

  // Lists and alignment live on the block above the caret.
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "bulletList") active.push("para.bullets");
    if (node.type.name === "orderedList") active.push("para.numbering");
    if (node.isTextblock) {
      const align = node.attrs.textAlign;
      if (align === "center") active.push("para.alignCenter");
      else if (align === "right") active.push("para.alignRight");
      else if (align === "justify") active.push("para.alignJustify");
      else active.push("para.alignLeft");
      break;
    }
  }
  return active;
}
