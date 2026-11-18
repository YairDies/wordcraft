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

## Phase 3 (first deliverable) — the ribbon and the keyboard as one piece

The ribbon is curated: 24 commands in four tabs (Area, Inicio, Insertar, Vista) with large and
small buttons and group labels, instead of the engine's 674-command dump.

**One keyboard map** (`src/keyboard/map.ts`) holds each command's label, accelerator and keytip per
UI language, and three consumers read it: the editor's ProseMirror keymap, the window key handler,
and the ribbon's tooltips and accessible names. They cannot disagree.

Word's rules are reproduced:

| | Behaviour |
|---|---|
| Shortcuts | follow the UI language (Ctrl+B Bold in English, Ctrl+N Negrita in Spanish) and are **reassignable** (File ▸ Options ▸ Keyboard), persisted to localStorage |
| Keytips | follow the UI language but are **fixed**; Word never lets a ribbon keytip be reassigned |
| Entry | Alt, then a tab letter, then a command letter (Alt, H, B applies bold); Esc leaves |

**Keytips are implemented here, not with @fluentui-contrib/react-keytips.** The package is
experimental and cost more than it gave: it overwrote `aria-keyshortcuts` with its own key
sequence, rendered a tab's label twice, and its portal covered the window with pointer events on,
swallowing every click aimed at the document. The replacement is a mode (`null` | `root` | a tab
id), one capture-phase listener, and a positioned span with `pointer-events: none` — no portal.

**Icons** come from @fluentui/react-icons — Fluent UI System Icons, MIT licensed, the same family
Microsoft 365 uses. `Regular` is the resting state; `Filled` marks a command that is on, the Fluent
2 convention and what Word does when Bold is active. Sizes follow the ribbon's proportions (32 px
large, 20 px small) rather than scaling one glyph. Each icon is `aria-hidden`: the button's
accessible name already describes the action. The Office *product* marks (the Word logo and its
siblings) are covered by Microsoft's brand guidelines and are not MIT, so none are used.

`scripts/verify-icons.mjs` covers the icons and `scripts/verify-ribbon.mjs` the eleven acceptance
points, while
`scripts/verify-keytips.mjs` the mode itself (hidden until Alt, Esc leaves, the document stays
clickable while keytips are shown).

Note on the tab label: Fluent's `Tab` renders a hidden spacer that duplicates the label in raw
`textContent`, which made the tabs read "ArchivoArchivo" to a naive check. The accessibility tree,
which is what a screen reader reads, exposes "Archivo" once — the test now asserts the accessible
name rather than the text content.

## Open debt: the in-flight window (Option B, explicitly parked)

Three cycles were spent on one bug: text typed while a structural operation is in flight can be
lost. It is not closed, and this is the honest record of it.

**What works.** Import (11 blocks, 3 headings, 2 lists, 1 table; 26 paragraphs and 9 nested cells
in the engine). Tables and their cell text are engine-owned. Lists are engine paragraphs carrying
numbering. Typing, marks and deletions go through the engine's cursor. Undo and redo run in Rust
and the view agrees with the engine after them. Perceived typing latency is ~2 ms; the engine
applies in ~0.15 ms.

**What does not.** Four acceptance checks fail — `paragraphsSplit`, `paragraphsJoined`,
`listItemsInEngine`, `engineHoldsEverything` — all because the first character typed after Enter
is lost. `scripts/verify-history.mjs` adds two independent failures: Backspace at a paragraph start
does not join (3a), and undo after creating a list does not restore the engine's text (4b).

**What was tried.** A deferred queue; a timed reconcile; a rebase of local transactions over the
engine's document; replaying the deferred edits as position-free commands (this duplicated text and
left an empty paragraph, so it was reverted); and sequence numbers with `last_applied_seq` so the
view replays only what the engine has not seen. The last one is the right model — it is what
prosemirror-collab does — but the replay still re-sends a `CursorMove` computed against the old
paths ("offset 12 splits a character at 15/0/0/0"), and re-translating the replayed steps turned
out to lose more text, not less.

**What a correct fix needs.** The queued edits must be re-translated against the new paths *before*
they are re-sent, and the `CursorMove` they carry must be dropped rather than replayed — the engine's
cursor after a structural operation is already where the person is typing. That is a change to
`replayUnconfirmed` alone, but it needs a passing test to land safely, and two attempts at it made
the document worse.

**Why it is parked.** Three cycles of the same bug without a green result is the signal to stop and
record, not to keep going. The rest of Phase 2 is functional and useful.

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
