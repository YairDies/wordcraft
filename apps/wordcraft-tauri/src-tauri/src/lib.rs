//! WordCraft desktop shell: a Tauri 2 host for `wordcraft-engine`.
//!
//! The point of this crate is that it contains **no document logic at all**. WordCraft's engine is
//! already front-end agnostic (`crates/ui-egui` is documented as swappable: nothing below it depends
//! on egui), so the whole editing model — session, undo, layout, the command registry with Word's
//! shortcuts — is reached through four commands here:
//!
//! * `engine_catalog` — every command with its id, label, ribbon location and default shortcut.
//!   The React ribbon and the keyboard map are **generated from this**, so Word's shortcuts are
//!   never re-typed in TypeScript and can never drift from the engine.
//! * `engine_run` — run one command by id. This is the same `Session::run` that the ribbon, the
//!   command palette, the CLI, the control channel and the MCP server call.
//! * `engine_state` — what the status bar and the tab strip need.
//! * `engine_render_page` — rasterise one laid-out page to PNG, for the document canvas.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::State;
use wordcraft_engine::{blank_document, Region, Session};
use wordcraft_render::{render_page, RenderOptions};

/// The editing session, owned by the Tauri app and shared by every window. One lock, because
/// `Session` is the single source of truth and commands must serialise on it.
struct AppState {
    session: Mutex<Session>,
}

impl AppState {
    fn new() -> Self {
        // Paper size comes from the engine's own default region, exactly as the egui app does.
        Self { session: Mutex::new(Session::new(blank_document(&Region::default()))) }
    }
}

/// A poisoned lock means a previous command panicked. Report it instead of propagating a panic:
/// the app stays up and the front end can offer to reload the document.
fn lock_error() -> String {
    "the editing session is unavailable (a command failed earlier)".to_string()
}

/// Base64 (standard alphabet, padded). Kept local so the shell adds no dependency for the one
/// place it needs to hand pixels to JavaScript.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk.first().copied().unwrap_or(0);
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = (u32::from(b0) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        let idx = |shift: u32| ALPHABET[((n >> shift) & 0x3F) as usize] as char;
        out.push(idx(18));
        out.push(idx(12));
        out.push(if chunk.len() > 1 { idx(6) } else { '=' });
        out.push(if chunk.len() > 2 { idx(0) } else { '=' });
    }
    out
}

/// Every command the engine knows, for the ribbon, the keyboard map and the command palette.
#[tauri::command]
fn engine_catalog(state: State<'_, AppState>) -> Result<Value, String> {
    let session = state.session.lock().map_err(|_| lock_error())?;
    Ok(session.registry.describe())
}

/// Run a command by id with its JSON parameters. Errors come back as text the UI can show.
#[tauri::command]
fn engine_run(state: State<'_, AppState>, id: String, params: Value) -> Result<Value, String> {
    let mut session = state.session.lock().map_err(|_| lock_error())?;
    session.run(&id, &params).map_err(|e| e.to_string())
}

/// What the status bar, the title and the tab strip read.
#[tauri::command]
fn engine_state(state: State<'_, AppState>) -> Result<Value, String> {
    let mut session = state.session.lock().map_err(|_| lock_error())?;
    // Layout first: it needs `&mut`, and the borrow has to end before the fields are read.
    let page_count = session.layout().pages.len();
    let title = match session.file_name.as_deref() {
        Some(name) if !name.is_empty() => name.to_string(),
        _ => "Document1".to_string(),
    };
    Ok(json!({
        "title": title,
        "path": session.path.as_ref().map(|p| p.display().to_string()),
        "dirty": session.dirty,
        "pageCount": page_count,
        "status": session.status,
    }))
}

/// One page as a base64 PNG, scaled so the browser can draw it 1:1 at its current zoom.
#[tauri::command]
fn engine_render_page(state: State<'_, AppState>, index: usize, scale: f64, dark: bool) -> Result<String, String> {
    let mut session = state.session.lock().map_err(|_| lock_error())?;
    let layout = session.layout();
    let page = layout.pages.get(index).ok_or_else(|| format!("page {} does not exist", index + 1))?;
    let scale = if scale.is_finite() && scale > 0.0 { scale.clamp(0.1, 8.0) as f32 } else { 1.0 };
    let png = render_page(&session.doc, page, scale, &RenderOptions { dark, ..Default::default() }).to_png();
    if png.is_empty() {
        return Err(format!("page {} could not be rendered", index + 1));
    }
    Ok(base64(&png))
}

/// Start the desktop app. Errors are reported, never panicked on: a word processor that crashes
/// while starting is a word processor that lost someone's work.
pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![engine_catalog, engine_run, engine_state, engine_render_page])
        .run(tauri::generate_context!());
    if let Err(err) = app {
        eprintln!("wordcraft: the window could not start: {err}");
        std::process::exit(1);
    }
}
