//! Reading and writing files the person picked in a native dialog.
//!
//! The paths come from the dialog plugin, so they are always ones the person chose; the commands
//! exist because the webview has no filesystem of its own. Nothing here is a general-purpose file
//! API: `read_bytes` returns the bytes of one chosen document and `write_text` stores the text the
//! shell has.
//!
//! Writing a real .docx needs the engine's own writer, which the bridge does not drive yet; the
//! save flow exists and stores text until that lands.

use std::path::Path;

/// Read a file the user picked in the open dialog.
#[tauri::command]
pub fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("{} could not be read: {}", path, e))
}

/// Write text beside a path the user picked in the save dialog.
#[tauri::command]
pub fn write_text(path: String, contents: String) -> Result<String, String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{} could not be created: {}", parent.display(), e))?;
        }
    }
    std::fs::write(target, contents).map_err(|e| format!("{} could not be written: {}", path, e))?;
    Ok(path)
}
