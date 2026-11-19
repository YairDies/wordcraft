/**
 * The curated ribbon: Word's shape, not the engine's 674-command dump.
 *
 * Every entry names a command that exists in `keyboard/map.ts`, so it is born with a keytip and an
 * accelerator — the two are added with the button, never afterwards.
 */
export interface RibbonItem {
  /** Command id from the keyboard map. */
  id: string;
  /** Word draws a few commands large and the rest small inside the same group. */
  size: "large" | "small";
}

export interface RibbonGroup {
  id: string;
  label: { es: string; en: string };
  items: RibbonItem[];
  /** Word puts a small dialog launcher at the group's corner; it opens the group's dialog. */
  launcher?: string;
}

export interface RibbonTab {
  /** Command id of the tab itself, which carries the first-level keytip. */
  id: string;
  groups: RibbonGroup[];
}

export const RIBBON: RibbonTab[] = [
  {
    id: "tab.file",
    groups: [
      {
        id: "file.file",
        label: { es: "Archivo", en: "File" },
        items: [
          { id: "file.save", size: "large" },
          { id: "edit.undo", size: "small" },
          { id: "edit.redo", size: "small" },
        ],
      },
    ],
  },
  {
    id: "tab.home",
    groups: [
      {
        id: "home.clipboard",
        label: { es: "Portapapeles", en: "Clipboard" },
        items: [
          { id: "edit.paste", size: "large" },
          { id: "edit.cut", size: "small" },
          { id: "edit.copy", size: "small" },
        ],
      },
      {
        id: "home.font",
        label: { es: "Fuente", en: "Font" },
        launcher: "dialog.font",
        items: [
          { id: "format.bold", size: "large" },
          { id: "format.italic", size: "small" },
          { id: "format.underline", size: "small" },
          { id: "format.strikethrough", size: "small" },
        ],
      },
      {
        id: "home.paragraph",
        label: { es: "Párrafo", en: "Paragraph" },
        launcher: "dialog.paragraph",
        items: [
          { id: "para.bullets", size: "large" },
          { id: "para.numbering", size: "small" },
          { id: "para.alignLeft", size: "small" },
          { id: "para.alignCenter", size: "small" },
          { id: "para.alignRight", size: "small" },
          { id: "para.alignJustify", size: "small" },
        ],
      },
      {
        id: "home.editing",
        label: { es: "Edición", en: "Editing" },
        items: [
          { id: "edit.find", size: "large" },
          { id: "edit.replace", size: "small" },
          { id: "edit.undo", size: "small" },
          { id: "edit.redo", size: "small" },
        ],
      },
    ],
  },
  {
    id: "tab.insert",
    groups: [
      {
        id: "insert.tables",
        label: { es: "Tablas", en: "Tables" },
        items: [{ id: "insert.table", size: "large" }],
      },
      {
        id: "insert.pages",
        label: { es: "Páginas", en: "Pages" },
        launcher: "dialog.pageSetup",
        items: [{ id: "insert.pageBreak", size: "small" }],
      },
    ],
  },
  {
    id: "tab.view",
    groups: [
      {
        id: "view.theme",
        label: { es: "Tema", en: "Theme" },
        items: [{ id: "view.theme", size: "large" }],
      },
    ],
  },
];
