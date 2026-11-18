# wordcraft-tauri — Fluent UI chrome over a ProseMirror editing surface

This directory is WordCraft's **Tauri 2 + React + Fluent UI React v9** front end. It replaces
`crates/ui-egui`, which this branch deletes.

## The split

| Concern | Owned by |
|---|---|
| Document model, layout, .docx reading/writing, PDF, proofing | the Rust crates (unchanged) |
| Command vocabulary, Word's shortcuts, ribbon locations | `wordcraft-engine`'s `CommandSpec` registry |
| Application chrome (title bar, ribbon, status bar, themes) | React + Fluent UI React v9 |
| The editing surface (caret, selection, typing, IME, screen-reader text) | ProseMirror |

The editing surface is a **DOM contenteditable**, not a rasterised canvas. That is a deliberate
accessibility decision: a canvas paints pixels that no screen reader can read, while
`contenteditable` exposes every word to NVDA, Narrator and VoiceOver and keeps the browser's
native caret, selection and IME. Layout fidelity to Word is traded for usable, accessible text.

## Bridge commands

| Command | Purpose |
|---|---|
| `engine_catalog` | Every command: id, label, ribbon location, shortcut, params. Builds the ribbon **and** the keyboard map, so Word's shortcuts are never re-typed in TypeScript. |
| `engine_run` | Run one command by id. |
| `engine_state` | Title, path, dirty flag, page count, status. |
| `engine_render_page` | A page rasterised by `wordcraft-render`. Not used by the editing surface; kept for print preview and thumbnails. |

## .docx import

`@docen/import-docx` (`parseDOCX`) converts a .docx into TipTap/ProseMirror JSON in the browser.
`src/editor/normalize.ts` then rewrites that JSON against our schema: unknown node types and
attributes are dropped **deliberately and reported**, rather than throwing. ProseMirror raises on
the first invalid attribute, and "open a document" must never become "lose a document".

Two importer details that cost real debugging time, recorded so nobody repeats it:

- `parseDOCX` only recognises a list when the paragraph carries **both** `w:ilvl` and `w:numId`.
  A .docx whose lists come from a *style* (as python-docx writes them) carries only `w:numId`
  there, and the list silently degrades to plain paragraphs.
- Tables come from `prosemirror-tables`, whose nodes are named `table_row`/`table_cell`; the
  importer emits `tableRow`/`tableCell`. The schema keys cannot simply be renamed, because the
  specs reference each other by name. `normalize.ts` translates the names instead.

## The editing bridge (engine owns the document)

ProseMirror is a projection. Every edit becomes engine operations, the engine applies them to its
own document, and the answer is a **delta**: only the blocks whose content changed.

```
key → ProseMirror transaction → translate.ts → ops → sync_apply (Rust) → delta → view
```

| Operation | Engine path |
|---|---|
| `InsertText` | `Selection::caret(Pos::body(block, byte))` then `text.insert` |
| `DeleteRange` | selection then `text.delete` — which honours Track Changes |
| `SetMark` | selection then `format.bold` / `format.italic` |

Offsets cross a UTF-16 (JavaScript, ProseMirror) to UTF-8 (Rust `String`) boundary on every
message; `sync.rs` converts both ways and refuses an offset that splits a surrogate pair.

The view is updated optimistically and corrected from the engine when the burst ends, so typing
never waits for the round trip. Edits the engine cannot express yet are **refused**, not applied
locally: letting the view drift from the engine would make its authority a lie.

### Measured (debug build, Windows, WebView2 157)

| Metric | p50 | p95 |
|---|---|---|
| Engine apply (Rust) | 0.2 ms | 0.4 ms |
| Keydown → view updated | 2.0 ms | 3.4 ms |
| Transport floor (empty IPC call) | 3.7 ms | 5.8 ms |
| Keydown → engine confirmation | 16.8 ms | 48.1 ms |

The confirmation is the one number over a 16 ms frame: it is the async IPC answer, which competes
with rendering for the next frame. It does not gate typing, because the view already moved.

## Running it

```powershell
cd apps/wordcraft-tauri
pnpm install
pnpm app:dev      # dev server + native window
pnpm app:build    # release bundle
```

`pnpm dev` alone serves the UI in a browser; the engine bridge is absent there and the app says so.

## Verifying it

```powershell
pnpm exec esbuild scripts/verify-docx-import.ts --bundle --platform=node --format=esm --outfile=.verify.mjs
node .verify.mjs samples/welcome.docx     # parseDOCX -> normalize -> schema, no browser

pnpm preview --port 4173                  # in another shell
node scripts/verify-a11y.mjs http://localhost:4173
```

`verify-a11y.mjs` drives the installed Chrome through Playwright and asserts what a screen reader
actually consumes: the editable element is `role=textbox`, `aria-multiline`, named "Document
text"; the document's heading appears in the accessibility tree; typing reaches both the DOM and
the accessibility tree; and `Ctrl+B` at a collapsed caret formats the text typed next. It also
writes `verify-screenshot.png`.

## Accessibility

- Ribbon: Fluent `TabList` (arrow-key navigation) over `role="group"` command groups.
- Commands carry `aria-keyshortcuts` in DOM form and a tooltip in platform form.
- Skip link past the chrome to the document.
- Status bar is `role="status" aria-live="polite"`.
- Themes: light, dark, high contrast — Fluent 2 themes generated from one brand ramp.

## Note on the upstream rule

The upstream repository's house rules require "Rust only — no handwritten JavaScript or
TypeScript" in native Craft apps. This branch departs from that deliberately; it is the reason for
the fork, and it is not proposed upstream.
