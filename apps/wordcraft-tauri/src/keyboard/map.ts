import type { Locale } from "./locale";

/**
 * The one place a command's keyboard identity is defined.
 *
 * Three consumers read this map and must never disagree: the editor's key handler, the ribbon's
 * tooltips and `aria-keyshortcuts`, and (later) the native menu accelerators. Word's own rules are
 * reproduced here:
 *
 * - **Shortcuts** follow the UI language: Ctrl+B is Bold in English and Ctrl+N is Negrita in
 *   Spanish, because the key is the mnemonic of the word. They are **customisable**.
 * - **Keytips** follow the UI language too, but are **fixed**: Word lets you reassign a shortcut
 *   from Options, never a ribbon keytip.
 */
export interface CommandKeys {
  /** Engine command id, or a UI command such as `tab.home`. */
  id: string;
  label: Record<Locale, string>;
  /** Portable accelerator, `Mod` meaning Ctrl or ⌘. May be empty when the command has none. */
  shortcut: Record<Locale, string>;
  /** The ribbon keytip sequence, relative to its tab. Fixed: never user-editable. */
  keytip: Record<Locale, string>;
}

export const COMMANDS: CommandKeys[] = [
  // Tabs — Word's first-level keytips.
  { id: "tab.file", label: { es: "Archivo", en: "File" }, shortcut: { es: "", en: "" }, keytip: { es: "A", en: "F" } },
  { id: "tab.home", label: { es: "Inicio", en: "Home" }, shortcut: { es: "", en: "" }, keytip: { es: "I", en: "H" } },
  { id: "tab.insert", label: { es: "Insertar", en: "Insert" }, shortcut: { es: "", en: "" }, keytip: { es: "N", en: "N" } },
  { id: "tab.view", label: { es: "Vista", en: "View" }, shortcut: { es: "", en: "" }, keytip: { es: "V", en: "W" } },

  // Home › Clipboard
  { id: "edit.cut", label: { es: "Cortar", en: "Cut" }, shortcut: { es: "Mod+X", en: "Mod+X" }, keytip: { es: "C", en: "X" } },
  { id: "edit.copy", label: { es: "Copiar", en: "Copy" }, shortcut: { es: "Mod+C", en: "Mod+C" }, keytip: { es: "O", en: "C" } },
  // "V" like the accelerator, not "P": Word uses P for the Paragraph launcher, and two keytips
  // with the same letter inside a tab is a collision the resolver settles by order.
  { id: "edit.paste", label: { es: "Pegar", en: "Paste" }, shortcut: { es: "Mod+V", en: "Mod+V" }, keytip: { es: "V", en: "V" } },

  // Home › Font
  { id: "format.bold", label: { es: "Negrita", en: "Bold" }, shortcut: { es: "Mod+N", en: "Mod+B" }, keytip: { es: "N", en: "B" } },
  { id: "format.italic", label: { es: "Cursiva", en: "Italic" }, shortcut: { es: "Mod+K", en: "Mod+I" }, keytip: { es: "K", en: "I" } },
  { id: "format.underline", label: { es: "Subrayado", en: "Underline" }, shortcut: { es: "Mod+S", en: "Mod+U" }, keytip: { es: "S", en: "U" } },
  { id: "format.strikethrough", label: { es: "Tachado", en: "Strikethrough" }, shortcut: { es: "", en: "" }, keytip: { es: "T", en: "S" } },

  // Home › Paragraph
  { id: "para.bullets", label: { es: "Viñetas", en: "Bullets" }, shortcut: { es: "", en: "" }, keytip: { es: "V", en: "U" } },
  { id: "para.numbering", label: { es: "Numeración", en: "Numbering" }, shortcut: { es: "", en: "" }, keytip: { es: "U", en: "N" } },
  { id: "para.alignLeft", label: { es: "Alinear a la izquierda", en: "Align Left" }, shortcut: { es: "Mod+Q", en: "Mod+L" }, keytip: { es: "A", en: "L" } },
  { id: "para.alignCenter", label: { es: "Centrar", en: "Center" }, shortcut: { es: "Mod+E", en: "Mod+E" }, keytip: { es: "E", en: "C" } },
  { id: "para.alignRight", label: { es: "Alinear a la derecha", en: "Align Right" }, shortcut: { es: "Mod+D", en: "Mod+R" }, keytip: { es: "D", en: "R" } },
  { id: "para.alignJustify", label: { es: "Justificar", en: "Justify" }, shortcut: { es: "Mod+J", en: "Mod+J" }, keytip: { es: "J", en: "J" } },

  // Home › Editing
  { id: "edit.find", label: { es: "Buscar", en: "Find" }, shortcut: { es: "Mod+F", en: "Mod+F" }, keytip: { es: "B", en: "F" } },
  { id: "edit.replace", label: { es: "Reemplazar", en: "Replace" }, shortcut: { es: "Mod+H", en: "Mod+H" }, keytip: { es: "R", en: "R" } },
  { id: "edit.undo", label: { es: "Deshacer", en: "Undo" }, shortcut: { es: "Mod+Z", en: "Mod+Z" }, keytip: { es: "X", en: "Z" } },
  { id: "edit.redo", label: { es: "Rehacer", en: "Redo" }, shortcut: { es: "Mod+Y", en: "Mod+Y" }, keytip: { es: "H", en: "Y" } },

  // Insert
  { id: "insert.table", label: { es: "Tabla", en: "Table" }, shortcut: { es: "", en: "" }, keytip: { es: "T", en: "T" } },
  { id: "insert.pageBreak", label: { es: "Salto de página", en: "Page Break" }, shortcut: { es: "Mod+Enter", en: "Mod+Enter" }, keytip: { es: "P", en: "P" } },

  // View
  { id: "view.theme", label: { es: "Tema de la vista", en: "View theme" }, shortcut: { es: "", en: "" }, keytip: { es: "T", en: "T" } },

  // Backstage. Word opens File with Alt+F (English) and Alt+A (Spanish, "Archivo").
  { id: "file.backstage", label: { es: "Archivo", en: "File" }, shortcut: { es: "Alt+A", en: "Alt+F" }, keytip: { es: "", en: "" } },
  // The Backstage's landing page. Without an entry here the panel announced its raw id.
  { id: "file.home", label: { es: "Inicio", en: "Home" }, shortcut: { es: "", en: "" }, keytip: { es: "", en: "" } },
  { id: "file.new", label: { es: "Nuevo", en: "New" }, shortcut: { es: "", en: "" }, keytip: { es: "", en: "" } },
  { id: "file.open", label: { es: "Abrir", en: "Open" }, shortcut: { es: "Mod+A", en: "Mod+O" }, keytip: { es: "", en: "" } },
  { id: "file.save", label: { es: "Guardar", en: "Save" }, shortcut: { es: "Mod+G", en: "Mod+S" }, keytip: { es: "", en: "" } },
  { id: "file.saveAs", label: { es: "Guardar como", en: "Save As" }, shortcut: { es: "", en: "" }, keytip: { es: "", en: "" } },
  { id: "file.saveCopy", label: { es: "Guardar una copia", en: "Save a Copy" }, shortcut: { es: "Alt+G", en: "Alt+S" }, keytip: { es: "", en: "" } },
  { id: "file.print", label: { es: "Imprimir", en: "Print" }, shortcut: { es: "Mod+P", en: "Mod+P" }, keytip: { es: "", en: "" } },
  { id: "file.share", label: { es: "Compartir", en: "Share" }, shortcut: { es: "", en: "" }, keytip: { es: "", en: "" } },
  { id: "file.export", label: { es: "Exportar", en: "Export" }, shortcut: { es: "", en: "" }, keytip: { es: "", en: "" } },
  { id: "file.close", label: { es: "Cerrar", en: "Close" }, shortcut: { es: "", en: "" }, keytip: { es: "", en: "" } },
  { id: "file.options", label: { es: "Opciones", en: "Options" }, shortcut: { es: "", en: "" }, keytip: { es: "", en: "" } },

  // Dialogs. Word opens Font with Ctrl+D (English) and Ctrl+M (Spanish, from "Fuente/M").
  { id: "dialog.font", label: { es: "Fuente…", en: "Font…" }, shortcut: { es: "Mod+M", en: "Mod+D" }, keytip: { es: "F", en: "F" } },
  { id: "dialog.paragraph", label: { es: "Párrafo…", en: "Paragraph…" }, shortcut: { es: "Mod+Alt+P", en: "Mod+Alt+P" }, keytip: { es: "P", en: "P" } },
  { id: "dialog.pageSetup", label: { es: "Configurar página…", en: "Page Setup…" }, shortcut: { es: "Mod+Alt+S", en: "Mod+Alt+S" }, keytip: { es: "C", en: "S" } },
];

const byId = new Map(COMMANDS.map((command) => [command.id, command]));

export const commandKeys = (id: string): CommandKeys | undefined => byId.get(id);
