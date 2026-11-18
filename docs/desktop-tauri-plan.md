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

## Phase 2 (continued) — the engine owns the cursor

Text operations no longer carry a position. This is the architectural change that removed the
failure class the bridge kept re-opening.

**Before.** Every operation named a block path (`[3]`, `[2,0,1,0]`) computed when the edit was
translated. A structural edit — Enter, a join — renumbered the blocks, so a keystroke translated
during that window addressed a path that had already moved. Three attempts to shrink the window
(deferred queue, timed reconcile, rebase) each moved it rather than closing it.

**After.** The engine keeps its cursor (`Session::Selection`) between calls, exactly as Word's
document object does:

| Operation | Carries a position? |
|---|---|
| `InsertText { text }` | no |
| `DeleteBack {}`, `DeleteForward {}`, `DeleteSelection {}` | no |
| `SplitBlock {}` (Enter) | no |
| `SetMark { mark, on }` | no — applies to the engine's selection |
| `CursorMove { path, offset }`, `SelectRange {…}` | yes |

Only the two operations that *move* the cursor name a place, and they are issued when the person
clicks or uses an arrow key, not when they type. Every answer returns the cursor, so the view sends
a `CursorMove` only when what it believes differs from what the engine reports. A position the
engine owns cannot be moved underneath it.

Structural changes still rebuild the view from `project_structure`, in the same reply that applied
them, so there is no second read to go stale.

### Undo: the engine is the authority

There are not two histories. `edit.undo`/`edit.redo` run in Rust over the engine's own undo
stack, and the view is corrected from the result — it holds no history of its own
(`prosemirror-history` is deliberately not installed). A view-local undo would fork the document.

`scripts/verify-history.mjs` pins this down: typing, Enter, undo, redo, undo after a merge, undo
after a list and after a table, chained undos, and a final check that engine and view hold the same
text.

## Phase 2 — the engine owns the document (done, minimal set)

Selected architecture: **the engine is authoritative**. ProseMirror is a projection that sends
operations and applies the engine's answers.

1. **Protocol** (`apps/wordcraft-tauri/src-tauri/src/sync.rs`): `sync_load` seeds the canonical
   document, `sync_apply` takes a batch of `InsertText` / `DeleteRange` / `SetMark` operations
   and answers with the changed blocks only, `sync_snapshot` re-reads everything after a command
   that bypassed the translator.
2. **Translator** (`src/editor/translate.ts`): ProseMirror steps → engine operations, positions
   read against `tr.docs[i]` so both sides stay in step.
3. **Engine applies to its model**: `text.insert`, `text.delete` (Track Changes aware) and
   `format.bold`/`format.italic` through `Session::run`, so undo and revisions stay in Rust.
4. **Minimal set validated**: insert, delete, bold, italic — 9 Rust tests including accent and
   emoji offset conversion, AutoCorrect, and an engine latency bound.
5. **Measured**: engine 0.2 ms p50; key to view 2.0 ms p50 / 3.4 ms p95; confirmation round trip
   16.8 ms p50 / 48.1 ms p95.

### Three bugs this cycle caught, all real

- Offsets were computed from `ResolvedPos.start(0)`, which is the document start, so every edit
  carried an absolute position; text landed in the wrong paragraph.
- Reconciling the view from the engine *between* keystrokes deleted the characters that were still
  in flight, and every later offset shifted — typed text arrived as "escribpido".
- Fluent Tooltip portals covered the document and swallowed clicks aimed at the editor.

### Deliberately out of scope

Structural edits (Enter, joining paragraphs, deleting across paragraphs, lists, tables, images).
The translator refuses them; the front end reports the refusal instead of applying an edit the
engine cannot represent. Lists and tables are seeded into the engine as **empty placeholder
blocks** so block indices stay aligned; their text is not engine-owned yet.

## Next: Phase 3 — the structural model

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
