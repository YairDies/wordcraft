# Desktop migration: egui → Tauri 2 + Fluent UI React v9 + ProseMirror

Status: **branch `feat/tauri-fluent-ui`. Phase 0 and Phase 1 landed.**

## The decision

The Rust engine is kept: it is the source of truth for the document model, layout, .docx I/O,
PDF, proofing and the command vocabulary. Only the presentation layers are replaced.

`crates/ui-egui` (98.7k lines) is **deleted**, together with the egui-hosted binaries
`apps/wordcraft` and `apps/wordcraft-web`, which cannot build without it. Git history on
`master` keeps them.

The editing surface is **ProseMirror** (a DOM contenteditable), not a rasterised page canvas:
accessibility outranks layout fidelity at this stage. A canvas is invisible to screen readers; a
contenteditable exposes the text natively.

## Layers

| Layer | Crate | State |
|---|---|---|
| L0 | `geom` | unchanged |
| L1 | `doc`, `fonts` | unchanged |
| L2 | `layout`, `docx`, `formats` | unchanged |
| L3 | `render`, `pdf` | unchanged (render now feeds print preview, not the editor) |
| L4 | `engine` | unchanged — Session, undo, command registry, Word catalog |
| L5 | `mcp`, `zotero` | unchanged |
| L6 | ~~`ui-egui`~~ | **deleted**; replaced by `apps/wordcraft-tauri` (Tauri host + React/Fluent/ProseMirror) |
| apps | `wordcraft-cli` | unchanged; `wordcraft` and `wordcraft-web` removed with the egui shell |

`cargo xtask layers` registers `wordcraft-tauri` as an exempt application crate.

## Phase 0 — skeleton (done)

Tauri 2 host, four bridge commands, Fluent shell with ribbon, title bar, status bar and three
themes. Keyboard map generated from the engine registry.

## Phase 1 — accessible editor (done)

1. `ui-egui` and its dependent apps deleted; workspace, xtask layers and CI adjusted.
2. Fluent UI v9 chrome; ProseMirror editing surface mounted with `@nytimes/react-prosemirror`.
3. Schema matching `@docen/import-docx` output, with a normalizer that drops unknown
   nodes/attributes deliberately instead of throwing.
4. `.docx` import through `@docen/import-docx`, drag-and-drop and File ▸ Open, verified on a
   sample document and by a headless Node run of the whole chain.
5. Accessibility verified against Chrome's accessibility tree (the data NVDA/Narrator consume):
   `role=textbox`, `aria-multiline`, document text in the AX tree, typing reaching both the DOM
   and the AX tree, `Ctrl+B` formatting the text typed at the caret.

## Next: Phase 2 — the engine becomes the model again

ProseMirror is currently the editing surface *and* the document of record; the Rust engine is only
consulted for its command catalog. The two must be joined:

- A document sync layer: ProseMirror transactions map onto engine commands (`text.insert`,
  `format.bold`, `insert.table`…) so undo, tracked changes, proofing and .docx export run on the
  engine's model. This is the load-bearing piece; everything else depends on it.
- Open/save through `wordcraft-docx` rather than only `@docen/import-docx`, so what we write back
  is a real .docx with Word's fidelity.
- Selection and formatting state reflected in the ribbon (bold button pressed when the caret is in
  bold text), driven by `engine_state`.

## Later phases

**Phase 3 — Word chrome parity.** Full ribbon (large/small buttons, galleries, split buttons,
File backstage, Quick Access Toolbar, Alt KeyTips), dialogs (Font, Paragraph, Page Setup, Find &
Replace), navigation pane, rulers, zoom.

**Phase 4 — platform.** File dialogs and recent files, printing, clipboard (`clipboard_html` /
`clipboard_rtf` already exist on `Session`), multi-window, autosave and recovery, packaging
(MSI/NSIS first).

## Known gaps

- The ribbon has not yet been visually verified in the Tauri window (it renders only when the
  engine bridge answers; in a plain browser there is no catalog, by design).
- Style-based lists: a .docx whose numbering lives only in a style degrades to paragraphs, because
  the importer requires a direct `w:ilvl`/`w:numId`. Word writes the direct form, so real Word
  documents are unaffected; python-docx output is.
- Word count is not shown; no engine command for it has been verified, so none was invented.
- Icons are text labels; artwork must be original per the repository's asset rules.
