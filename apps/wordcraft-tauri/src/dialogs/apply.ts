import type { EditorView } from "prosemirror-view";
import { wordcraftSchema } from "../editor/schema";

/**
 * Applying a dialog's values to the document.
 *
 * These go through the view's own transactions, so they travel the same path as typing: the
 * bridge translates them into engine operations and the engine's answer comes back as a delta.
 * Anything the schema cannot express (page margins, which belong to a section and not to the
 * editor's model yet) is applied visually and said so.
 */
export interface FontValues {
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
}

export function applyFont(view: EditorView, values: FontValues): void {
  const { from, to } = view.state.selection;
  const tr = view.state.tr;
  const marks = wordcraftSchema.marks;

  const setMark = (type: typeof marks.bold, on: boolean) => {
    if (on) tr.addMark(from, to, type.create());
    else tr.removeMark(from, to, type);
  };
  setMark(marks.bold, values.bold);
  setMark(marks.italic, values.italic);
  setMark(marks.underline, values.underline);
  setMark(marks.strike, values.strike);

  const attrs: Record<string, string> = {};
  if (values.family) attrs.fontFamily = values.family;
  if (values.size) attrs.fontSize = `${values.size}pt`;
  if (values.color) attrs.color = values.color;
  if (Object.keys(attrs).length) {
    tr.removeMark(from, to, marks.textStyle);
    tr.addMark(from, to, marks.textStyle.create(attrs));
  }
  if (tr.docChanged) view.dispatch(tr);
  view.focus();
}

export interface ParagraphValues {
  align: "left" | "center" | "right" | "justify";
  indentLeft: number;
  indentRight: number;
  indentFirst: number;
  spaceBefore: number;
  spaceAfter: number;
  lineHeight: number;
}

export function applyParagraph(view: EditorView, values: ParagraphValues): void {
  const { from, to } = view.state.selection;
  const type = wordcraftSchema.nodes.paragraph;
  const tr = view.state.tr;
  const apply = (node: Parameters<typeof Object>[0] & { type: unknown; attrs: Record<string, unknown> }, pos: number) => {
    tr.setNodeMarkup(pos, undefined, {
      ...(node as { attrs: Record<string, unknown> }).attrs,
      textAlign: values.align,
      textIndent: values.indentFirst ? `${values.indentFirst}pt` : null,
      marginLeft: values.indentLeft ? `${values.indentLeft}pt` : null,
      marginRight: values.indentRight ? `${values.indentRight}pt` : null,
      marginTop: values.spaceBefore ? `${values.spaceBefore}pt` : null,
      marginBottom: values.spaceAfter ? `${values.spaceAfter}pt` : null,
      lineHeight: values.lineHeight ? String(values.lineHeight) : null,
    });
  };

  if (from === to) {
    // A collapsed caret still belongs to a paragraph: Word formats the paragraph it sits in.
    for (let depth = view.state.selection.$from.depth; depth > 0; depth -= 1) {
      const node = view.state.selection.$from.node(depth);
      if (node.type === type) {
        apply(node as never, view.state.selection.$from.before(depth));
        break;
      }
    }
  }

  if (from !== to) {
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type !== type) return true;
      apply(node as never, pos);
      return true;
    });
  }
  if (tr.docChanged) view.dispatch(tr);
  view.focus();
}

export interface PageValues {
  top: number;
  bottom: number;
  left: number;
  right: number;
  orientation: "portrait" | "landscape";
}

/**
 * Page setup is applied to the sheet the document is drawn on.
 *
 * Margins belong to a section in OOXML, and the editor's model does not carry sections yet, so
 * this changes what the person sees and is recorded as view-level until the engine owns it.
 */
export function applyPage(sheet: HTMLElement | null, values: PageValues): void {
  if (!sheet) return;
  const unit = "in";
  sheet.style.padding = `${values.top / 72}${unit} ${values.right / 72}${unit} ${values.bottom / 72}${unit} ${values.left / 72}${unit}`;
  sheet.style.width = values.orientation === "landscape" ? "11in" : "8.5in";
  sheet.style.minHeight = values.orientation === "landscape" ? "8.5in" : "11in";
}
