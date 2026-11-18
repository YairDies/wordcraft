# Desktop migration: egui → Tauri 2 + Fluent UI React v9

Status: **branch `feat/tauri-fluent-ui`, skeleton in place.**

## Starting point

| Layer | Crate | Kept? |
|---|---|---|
| L0 | `geom` | yes |
| L1 | `doc`, `fonts` | yes |
| L2 | `layout`, `docx`, `formats` | yes |
| L3 | `render`, `pdf` | yes |
| L4 | `engine` (Session, undo, command registry, Word catalog) | yes |
| L5 | `mcp` | yes |
| L6 | `ui-egui` (98.7k lines, egui) | **replaced** by `apps/wordcraft-tauri` |
| apps | `apps/wordcraft` (egui window host) | **replaced** by the Tauri host |

The engine is front-end agnostic by design, so the swap is at L6 and above only. Nothing below L6
changes, and `cargo xtask layers` still holds because the new shell sits above the boundary.

## Phases

**Phase 0 — skeleton (done).**
Workspace membership, Tauri 2 host, four bridge commands, Fluent UI shell with ribbon, title bar,
canvas, status bar and three themes. Keyboard map generated from the engine registry.

**Phase 1 — the document surface.**
- Caret, selection and hit-testing over the rendered page images. The engine already exposes hit
  testing through `layout`; the bridge needs `engine_hit_test` / `engine_set_selection`.
- Typing: a hidden `contenteditable` or a key listener that forwards to `text.insert`, matching
  `docs/typing-parity.md`. IME composition must go through the engine's IME state machine.
- Page images must be cached and invalidated per page, not re-rendered wholesale on every edit.

**Phase 2 — Word chrome parity.**
- Full ribbon: large/small buttons, galleries (Styles, font list), split buttons, drop-downs,
  the File backstage, the Quick Access Toolbar, KeyTips (Alt sequences).
- Dialogs: Font, Paragraph, Page Setup, Find & Replace.
- Navigation pane, rulers, status-bar view buttons, zoom slider.

**Phase 3 — platform integration.**
- File dialogs (drag & drop, recent files, Save As), printing, clipboard formats
  (`clipboard_html` / `clipboard_rtf` already exist on `Session`).
- Multi-window, autosave and crash recovery (`recovery.rs` is already engine-side).
- Packaging: MSI/NSIS, .dmg, AppImage/deb, plus the existing Flatpak work.

**Phase 4 — parity gates.**
- Port `docs/ui-parity.md` checks to the new shell; keep `cargo xtask parity` green by driving it
  through the CLI/control channel rather than the egui harness.

## Accessibility requirements (non-negotiable)

- Every ribbon control reachable and operable by keyboard alone, with a visible focus ring.
- Shortcuts identical to Word's, sourced from `CommandSpec::shortcut` — one source of truth.
- KeyTips (Alt → letter sequences) mirroring Word's ribbon access keys.
- Announcements for selection, formatting state and status via ARIA live regions.
- Theme support: light, dark and high contrast, honouring the OS setting.

## Known gaps in this skeleton

- The typed character stream and IME are not wired yet; the canvas is read-only.
- Word count is not shown: no engine command for it has been verified, so none was invented.
- Icons are text labels for now; artwork must be original (see the repository's asset rules).
