# wordcraft-tauri — the Fluent UI desktop front end

This directory is WordCraft's **Tauri 2 + React + Fluent UI React v9** front end. It replaces
`crates/ui-egui` as the desktop shell; the document engine underneath is unchanged.

## Why the engine survives the swap

WordCraft was already built so the UI is a thin, swappable layer:

- `crates/ui-egui/Cargo.toml` describes itself as *"swappable: nothing below depends on it"*.
- `crates/engine` has **no** egui, eframe, winit or rfd dependency.
- **Everything is a command**: each user-visible action is a `CommandSpec` (id, label, ribbon
  location, default shortcut, params) executed by `Session::run`.

So this shell owns no document behaviour. It asks the engine for its command catalog and renders
it. Word's shortcuts therefore live in exactly one place — the Rust registry — and the React side
can never drift from them.

## What each bridge command does

| Command | Purpose |
|---|---|
| `engine_catalog` | Every command: id, label, ribbon location, shortcut, params. Builds the ribbon **and** the keyboard map. |
| `engine_run` | Run one command by id (`format.bold`, `insert.table`, …). |
| `engine_state` | Title, path, dirty flag, page count, engine status — for the chrome. |
| `engine_render_page` | One laid-out page rasterised by `wordcraft-render` to a base64 PNG. |

The canvas shows the engine's own typesetting rather than a browser re-implementation of it, so
layout parity with the .docx format is not re-litigated in TypeScript.

## Layout

```
apps/wordcraft-tauri/
├── index.html, vite.config.ts, tsconfig.json   # front end build
├── src/                                        # React + Fluent UI v9
│   ├── bridge/engine.ts                        # typed invoke() wrappers
│   ├── a11y/shortcuts.ts                       # Mod+B ⇄ Ctrl+B, aria-keyshortcuts
│   ├── theme/themes.ts                         # light / dark / high contrast
│   ├── shell/                                  # TitleBar, Ribbon, Canvas, StatusBar
│   └── App.tsx
└── src-tauri/                                  # the Rust host (workspace member)
    └── src/lib.rs                              # the four commands above
```

## Running it

```powershell
cd apps/wordcraft-tauri
pnpm install
pnpm app:dev      # dev server + native window
pnpm app:build    # release bundle
```

`pnpm dev` alone serves the UI in a browser; the engine bridge is absent there and the app says so.

## Accessibility

- The ribbon is a Fluent `TabList` (arrow-key navigation) over `role="group"` command groups.
- Command buttons carry `aria-keyshortcuts` in DOM form and a tooltip in platform form.
- A skip link jumps past the chrome to the document.
- The status bar is `role="status" aria-live="polite"`.
- Shortcuts come from the engine, so they match Word: `Mod+B`, `Mod+I`, `Mod+U`, `Mod+S`,
  `Mod+Z`/`Mod+Y`, `F7` (spelling), and the rest of the registry.

## Note on the upstream rule

The upstream repository's house rules require "Rust only — no handwritten JavaScript or
TypeScript" in native Craft apps. This branch deliberately departs from that rule, which is the
whole point of the fork. It is not proposed upstream.
