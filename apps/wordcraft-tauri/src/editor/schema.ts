import { Schema } from "prosemirror-model";
import type { DOMOutputSpec, NodeSpec, MarkSpec } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";

/**
 * The schema is dictated by `@docen/import-docx`: it emits TipTap-flavoured JSON whose node names
 * and attributes are fixed. Every name below was read from that package's output, not guessed.
 *
 * Extra attributes are declared permissively: ProseMirror rejects attributes it does not know
 * about, and Word paragraphs carry far more formatting than we render today. Declaring them lets
 * a document load intact, and each one can be styled in later.
 */

/** Word paragraph-level formatting attached to blocks and list items. */
const blockStyleAttrs: Record<string, { default: null }> = {
  textAlign: { default: null },
  lineHeight: { default: null },
  textIndent: { default: null },
  marginTop: { default: null },
  marginBottom: { default: null },
  marginLeft: { default: null },
  marginRight: { default: null },
  paddingTop: { default: null },
  paddingBottom: { default: null },
  paddingLeft: { default: null },
  paddingRight: { default: null },
  backgroundColor: { default: null },
  color: { default: null },
  fontFamily: { default: null },
  fontSize: { default: null },
};

/** Word character-level formatting carried by the `textStyle` mark. */
const textStyleAttrs = {
  color: { default: null },
  backgroundColor: { default: null },
  fontFamily: { default: null },
  fontSize: { default: null },
  letterSpacing: { default: null },
  lineHeight: { default: null },
  rtl: { default: null },
};

/**
 * Turn the subset of block attributes we know into an inline CSS declaration list, so imported
 * Word formatting actually shows on screen instead of being silently dropped.
 */
function styleFrom(attrs: Record<string, unknown>): string | null {
  const css: string[] = [];
  const push = (property: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) css.push(`${property}: ${value}`);
  };
  push("text-align", attrs.textAlign);
  push("line-height", attrs.lineHeight);
  push("text-indent", attrs.textIndent);
  push("margin-top", attrs.marginTop);
  push("margin-bottom", attrs.marginBottom);
  push("margin-left", attrs.marginLeft);
  push("margin-right", attrs.marginRight);
  push("padding-top", attrs.paddingTop);
  push("padding-bottom", attrs.paddingBottom);
  push("padding-left", attrs.paddingLeft);
  push("padding-right", attrs.paddingRight);
  push("background-color", attrs.backgroundColor);
  push("color", attrs.color);
  push("font-family", attrs.fontFamily);
  push("font-size", attrs.fontSize);
  return css.length ? css.join("; ") : null;
}

function blockToDOM(tag: string, attrs: Record<string, unknown>): DOMOutputSpec {
  const style = styleFrom(attrs);
  return style ? [tag, { style }, 0] : [tag, 0];
}

/**
 * Tables come from `prosemirror-tables`, which names its nodes `table`, `table_row`, `table_cell`
 * and `table_header`. Their content expressions refer to those names, so the keys cannot be
 * renamed after the fact: the schema would not resolve. The importer's camelCase names are
 * translated to these instead (see the aliases in normalize.ts).
 */
const tableSpecs = tableNodes({ tableGroup: "block", cellContent: "block+", cellAttributes: {} });

const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },
  paragraph: { content: "inline*", group: "block", attrs: blockStyleAttrs, parseDOM: [{ tag: "p" }], toDOM: (node) => blockToDOM("p", node.attrs) },
  heading: {
    attrs: { level: { default: 1 }, ...blockStyleAttrs },
    content: "inline*",
    group: "block",
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node) => blockToDOM(`h${Math.min(6, Math.max(1, Number(node.attrs.level) || 1))}`, node.attrs),
  },
  blockquote: { content: "block+", group: "block", defining: true, parseDOM: [{ tag: "blockquote" }], toDOM: () => ["blockquote", 0] },
  codeBlock: {
    content: "text*",
    marks: "",
    group: "block",
    code: true,
    defining: true,
    attrs: { language: { default: null } },
    parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
    toDOM: (node) => ["pre", node.attrs.language ? { "data-language": String(node.attrs.language) } : {}, ["code", 0]],
  },
  horizontalRule: { group: "block", parseDOM: [{ tag: "hr" }], toDOM: () => ["hr"] },
  image: {
    inline: true,
    group: "inline",
    draggable: true,
    attrs: { src: {}, alt: { default: null }, title: { default: null }, width: { default: null }, height: { default: null }, crop: { default: null } },
    parseDOM: [{ tag: "img[src]", getAttrs: (dom) => ({ src: (dom as HTMLElement).getAttribute("src"), alt: (dom as HTMLElement).getAttribute("alt") }) }],
    toDOM: (node) => {
      const { src, alt, title, width, height } = node.attrs;
      const style = [width ? `width: ${width}px` : "", height ? `height: ${height}px` : ""].filter(Boolean).join("; ");
      return ["img", { src: String(src ?? ""), alt: alt ? String(alt) : "", title: title ? String(title) : null, style: style || null }];
    },
  },
  hardBreak: { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] },
  text: { group: "inline" },
  bulletList: {
    content: "listItem+",
    group: "block",
    parseDOM: [{ tag: "ul" }],
    toDOM: () => ["ul", 0],
  },
  orderedList: {
    content: "listItem+",
    group: "block",
    attrs: { start: { default: 1 }, type: { default: null } },
    parseDOM: [{ tag: "ol" }],
    toDOM: (node) => ["ol", Number(node.attrs.start) > 1 ? { start: Number(node.attrs.start) } : {}, 0],
  },
  listItem: { content: "paragraph block*", defining: true, parseDOM: [{ tag: "li" }], toDOM: () => ["li", 0] },
  taskList: { content: "taskItem+", group: "block", defining: true, toDOM: () => ["ul", { "data-task-list": "true" }, 0] },
  taskItem: {
    content: "paragraph block*",
    defining: true,
    attrs: { checked: { default: false } },
    toDOM: (node) => ["li", { "data-checked": node.attrs.checked ? "true" : "false" }, ["input", { type: "checkbox", disabled: "disabled", checked: node.attrs.checked ? "checked" : null }], 0],
  },
  ...tableSpecs,
};

const marks: Record<string, MarkSpec> = {
  bold: { parseDOM: [{ tag: "strong" }, { tag: "b" }], toDOM: () => ["strong", 0] },
  italic: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
  underline: { parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] },
  strike: { attrs: { doubleStrike: { default: null } }, parseDOM: [{ tag: "s" }, { tag: "del" }], toDOM: () => ["s", 0] },
  subscript: { excludes: "superscript", parseDOM: [{ tag: "sub" }], toDOM: () => ["sub", 0] },
  superscript: { excludes: "subscript", parseDOM: [{ tag: "sup" }], toDOM: () => ["sup", 0] },
  highlight: { attrs: { color: { default: null } }, parseDOM: [{ tag: "mark" }], toDOM: (mark) => ["mark", mark.attrs.color ? { style: `background-color: ${mark.attrs.color}` } : {}, 0] },
  link: {
    attrs: { href: {}, title: { default: null }, target: { default: null } },
    inclusive: false,
    parseDOM: [{ tag: "a[href]", getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute("href") }) }],
    toDOM: (mark) => ["a", { href: String(mark.attrs.href ?? ""), target: mark.attrs.target ? String(mark.attrs.target) : "_blank", rel: "noopener noreferrer nofollow" }, 0],
  },
  textStyle: { attrs: textStyleAttrs, parseDOM: [{ tag: "span" }], toDOM: (mark) => {
    const css = [mark.attrs.color ? `color: ${mark.attrs.color}` : "", mark.attrs.backgroundColor ? `background-color: ${mark.attrs.backgroundColor}` : "", mark.attrs.fontFamily ? `font-family: ${mark.attrs.fontFamily}` : "", mark.attrs.fontSize ? `font-size: ${mark.attrs.fontSize}` : "", mark.attrs.letterSpacing ? `letter-spacing: ${mark.attrs.letterSpacing}` : ""].filter(Boolean).join("; ");
    return ["span", css ? { style: css } : {}, 0];
  } },
};

export const wordcraftSchema = new Schema({ nodes, marks });
