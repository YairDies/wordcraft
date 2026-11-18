import type { MarkSpec, NodeSpec, Node as PMNode, Schema } from "prosemirror-model";

/**
 * Converts `@docen/import-docx` output into something our schema will accept.
 *
 * The importer describes real Word files, and real Word files contain more than any schema models:
 * unknown node types, attributes we do not render, marks without their required values. ProseMirror
 * throws on the first of those, which would turn "open a document" into "lose a document". So the
 * JSON is walked first and anything unsupported is dropped deliberately, and reported, instead of
 * exploding.
 */

type Json = Record<string, unknown>;

/**
 * Node names the importer uses that our schema spells differently. Tables come from
 * `prosemirror-tables`, whose specs must keep their own snake_case names because their content
 * expressions refer to each other by name.
 */
const NODE_ALIASES: Record<string, string> = {
  tableRow: "table_row",
  tableCell: "table_cell",
  tableHeader: "table_header",
};

const resolveNodeName = (name: string): string => NODE_ALIASES[name] ?? name;

export interface NormalizeResult {
  doc: PMNode;
  /** Node and mark types dropped on the way in, for a diagnostic message. */
  dropped: string[];
}

const requiredMissing = (spec: MarkSpec | NodeSpec, attrs: Record<string, unknown> | undefined): boolean => {
  const declared = spec.attrs ?? {};
  for (const [name, attribute] of Object.entries(declared)) {
    const isRequired = (attribute as { default?: unknown }).default === undefined;
    if (isRequired && (attrs?.[name] === undefined || attrs?.[name] === null)) return true;
  }
  return false;
};

const keepAttrs = (spec: NodeSpec | MarkSpec, attrs: unknown): Record<string, unknown> => {
  const declared = spec.attrs ?? {};
  const source = (attrs ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(declared)) {
    if (source[name] !== undefined) out[name] = source[name];
  }
  return out;
};

function cleanMarks(marks: unknown, schema: Schema, dropped: Set<string>): Json[] {
  if (!Array.isArray(marks)) return [];
  const out: Json[] = [];
  for (const mark of marks as Json[]) {
    const name = String(mark?.type ?? "");
    const spec = schema.marks[name];
    if (!spec) {
      if (name) dropped.add(`mark:${name}`);
      continue;
    }
    const attrs = keepAttrs(spec, mark.attrs);
    if (requiredMissing(spec, attrs)) {
      dropped.add(`mark:${name}`);
      continue;
    }
    out.push({ type: name, attrs });
  }
  return out;
}

function cleanInline(node: Json, schema: Schema, dropped: Set<string>): Json | null {
  const type = resolveNodeName(String(node.type ?? ""));
  if (type === "text") {
    const text = typeof node.text === "string" ? node.text : "";
    if (!text) return null;
    return { type: "text", text, marks: cleanMarks(node.marks, schema, dropped) };
  }
  const spec = schema.nodes[type];
  if (!spec) {
    dropped.add(`node:${type}`);
    // An unknown inline container (a field, a content control) still carries readable text.
    return inlineChildren(node, schema, dropped);
  }
  const content = Array.isArray(node.content)
    ? (node.content as Json[]).flatMap((child): Json[] => {
        const cleaned = cleanInline(child, schema, dropped);
        return cleaned ? [cleaned] : [];
      })
    : [];
  const attrs = keepAttrs(spec, node.attrs);
  if (requiredMissing(spec, attrs)) {
    dropped.add(`node:${type}`);
    return inlineChildren(node, schema, dropped);
  }
  return { type, attrs, content };
}

/** Best-effort flattening of an unknown inline node into the text it contains. */
function inlineChildren(node: Json, schema: Schema, dropped: Set<string>): Json | null {
  if (!Array.isArray(node.content)) return null;
  const content = (node.content as Json[]).flatMap((child): Json[] => {
    const cleaned = cleanInline(child, schema, dropped);
    return cleaned ? [cleaned] : [];
  });
  if (!content.length) return null;
  return { type: "text", text: plainText(content), marks: [] };
}

function plainText(json: Json[]): string {
  return json.map((node) => (node.type === "text" ? String(node.text ?? "") : plainText((node.content as Json[]) ?? []))).join("");
}

function cleanBlock(node: Json, schema: Schema, dropped: Set<string>): Json[] {
  const type = resolveNodeName(String(node.type ?? ""));
  if (!type) return [];
  const spec = schema.nodes[type];
  if (!spec) {
    dropped.add(`node:${type}`);
    // A wrapper we do not model (a section, a textbox): keep what is inside it.
    const inner = Array.isArray(node.content) ? (node.content as Json[]).flatMap((child) => cleanBlock(child, schema, dropped)) : [];
    const text = plainText((node.content as Json[]) ?? []);
    return inner.length ? inner : text ? [{ type: "paragraph", attrs: {}, content: [{ type: "text", text, marks: [] }] }] : [];
  }
  const attrs = keepAttrs(spec, node.attrs);
  if (requiredMissing(spec, attrs)) {
    dropped.add(`node:${type}`);
    return [];
  }
  const rawChildren = Array.isArray(node.content) ? (node.content as Json[]) : [];
  const content: Json[] = [];
  for (const child of rawChildren) {
    if (spec.inlineContent) {
      const inline = cleanInline(child, schema, dropped);
      if (inline) content.push(inline);
    } else {
      content.push(...cleanBlock(child, schema, dropped));
    }
  }
  return [{ type, attrs, content }];
}

/** Wrap loose inline nodes in a paragraph so the document keeps a valid block structure. */
function ensureBlocks(json: Json[]): Json[] {
  if (!json.length) return [{ type: "paragraph", attrs: {}, content: [] }];
  return json;
}

export function normalizeDocxJson(json: unknown, schema: Schema): NormalizeResult {
  const dropped = new Set<string>();
  const root = (json ?? {}) as Json;
  const rawChildren = Array.isArray(root.content) ? (root.content as Json[]) : [];
  const blocks = rawChildren.flatMap((child) => cleanBlock(child, schema, dropped));
  const sanitized = { type: "doc", content: ensureBlocks(blocks) };

  try {
    return { doc: schema.nodeFromJSON(sanitized), dropped: [...dropped] };
  } catch {
    // Last resort: never fail to open a document. Show its text.
    const text = plainText(rawChildren);
    const paragraph = { type: "paragraph", attrs: {}, content: text ? [{ type: "text", text, marks: [] }] : [] };
    return { doc: schema.nodeFromJSON({ type: "doc", content: [paragraph] }), dropped: [...dropped, "structure"] };
  }
}
