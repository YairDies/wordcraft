//! Engine-authoritative editing bridge.
//!
//! The Rust document is the only source of truth. ProseMirror is a projection: it shows what the
//! engine holds, and every edit it produces is translated into engine commands, applied to the
//! canonical document, and answered with a *delta* — only the blocks whose content changed, never
//! the whole document.
//!
//! Offsets on the wire are UTF-16 code units (what JavaScript and ProseMirror count). The engine
//! addresses text by UTF-8 byte offset (`String::insert_str`), so every crossing of the boundary
//! converts. Getting this wrong would corrupt any document with an accent, which for Spanish is
//! not an edge case.
//!
//! Structural edits (splitting or merging paragraphs, tables) are deliberately out of scope in
//! this first cycle: the front end refuses them rather than letting the two models drift apart.

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Instant;

use serde::Deserialize;
use serde_json::{json, Value};
use wordcraft_doc::props::CharProps;
use wordcraft_doc::{Block, Document, Paragraph, Path, Pos, StoryRef};
use wordcraft_engine::{CmdError, Session};

use crate::AppState;

/// One editing operation, as the front end describes it.
///
/// Field names are snake_case on purpose: this protocol is private to the bridge, and matching
/// Rust exactly is worth more here than JavaScript idiom.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op")]
pub enum SyncOp {
    /// Insert text at a caret.
    InsertText { block: usize, offset: usize, text: String },
    /// Delete from one point to another (both ends may be in different blocks).
    DeleteRange { from_block: usize, from_offset: usize, to_block: usize, to_offset: usize },
    /// Turn a character mark on or off over a range inside one block.
    SetMark { block: usize, from: usize, to: usize, mark: String, on: bool },
}

/// A block as the engine projects it: runs of text with their formatting.
#[derive(Clone, Debug)]
pub struct BlockOut {
    pub index: usize,
    pub runs: Vec<RunOut>,
}

#[derive(Clone, Debug)]
pub struct RunOut {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
}

impl BlockOut {
    fn to_json(&self) -> Value {
        let runs: Vec<Value> = self
            .runs
            .iter()
            .map(|r| json!({"text": r.text, "bold": r.bold, "italic": r.italic, "underline": r.underline}))
            .collect();
        json!({"index": self.index, "runs": runs})
    }
}

fn lock_error() -> String {
    "the editing session is unavailable (a command failed earlier)".to_string()
}

fn cmd_error(e: CmdError) -> String {
    e.to_string()
}

/// Largest valid char boundary at or below `byte` (`str::floor_char_boundary` is not stable).
fn floor_char_boundary(text: &str, byte: usize) -> usize {
    let mut i = byte.min(text.len());
    while i > 0 && !text.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// UTF-16 code units (JavaScript) to UTF-8 bytes (the engine). `None` when the offset lands
/// inside a surrogate pair, which no well-formed client can send.
pub fn utf16_to_byte(text: &str, utf16: usize) -> Option<usize> {
    if utf16 == 0 {
        return Some(0);
    }
    let mut units = 0usize;
    for (byte, ch) in text.char_indices() {
        units += ch.len_utf16();
        if units == utf16 {
            return Some(byte + ch.len_utf8());
        }
        if units > utf16 {
            return None;
        }
    }
    if units == utf16 { Some(text.len()) } else { None }
}

/// UTF-8 bytes to UTF-16 code units.
pub fn byte_to_utf16(text: &str, byte: usize) -> usize {
    let end = floor_char_boundary(text, byte);
    text.get(..end).map_or(0, |prefix| prefix.encode_utf16().count())
}

/// The paragraph at a top-level body index, if it is one.
fn body_para(doc: &Document, block: usize) -> Option<&Paragraph> {
    doc.para(StoryRef::Body, &Path::top(block))
}

/// An engine position for a (block, UTF-16 offset) pair.
fn position(doc: &Document, block: usize, offset: usize) -> Result<Pos, String> {
    let para = body_para(doc, block).ok_or_else(|| format!("block {} is not a top-level paragraph", block))?;
    let byte = utf16_to_byte(&para.text, offset).ok_or_else(|| format!("offset {} splits a character in block {}", offset, block))?;
    Ok(Pos::body(block, byte))
}

/// Project one block from the canonical document. Runs cover the text exactly; a run whose length
/// would run past the text is clipped rather than trusted.
pub fn project_block(doc: &Document, index: usize) -> Option<BlockOut> {
    let para = body_para(doc, index)?;
    let mut runs: Vec<RunOut> = Vec::new();
    let mut start = 0usize;
    for run in &para.runs {
        let end = floor_char_boundary(&para.text, start.saturating_add(run.len));
        if end > start {
            if let Some(text) = para.text.get(start..end) {
                if !text.is_empty() {
                    let props = &run.props;
                    runs.push(RunOut {
                        text: text.to_string(),
                        bold: props.bold == Some(true),
                        italic: props.italic == Some(true),
                        underline: props.underline.is_some(),
                    });
                }
            }
        }
        start = end;
    }
    // Text the run list does not cover (should not happen) is still shown rather than lost.
    if start < para.text.len() {
        if let Some(rest) = para.text.get(floor_char_boundary(&para.text, start)..) {
            if !rest.is_empty() {
                runs.push(RunOut { text: rest.to_string(), bold: false, italic: false, underline: false });
            }
        }
    }
    Some(BlockOut { index, runs })
}

/// Every top-level block the front end may project.
pub fn project_all(doc: &Document) -> Vec<BlockOut> {
    let count = doc.paragraph_count();
    (0..count).filter_map(|i| project_block(doc, i)).collect()
}

/// What one batch of operations produced.
pub struct ApplyResult {
    pub blocks: Vec<BlockOut>,
    pub caret: Option<(usize, usize)>,
    /// Time spent inside the engine, in microseconds.
    pub micros: u64,
}

/// Replace a session's document with the given blocks.
pub fn load_blocks(session: &mut Session, blocks: &[String]) -> Result<(), String> {
    let mut doc = Document::new();
    {
        let story = doc.story_mut(StoryRef::Body).map_err(|e| e.to_string())?;
        story.clear();
        for text in blocks {
            story.push(Arc::new(Block::Para(Paragraph::with_text(text, CharProps::default()))));
        }
        if story.is_empty() {
            story.push(Arc::new(Block::Para(Paragraph::new())));
        }
    }
    *session = Session::new(doc);
    Ok(())
}

/// Replace the canonical document with the blocks the front end starts from. This is the one
/// point where the front end seeds the engine; from here on the engine owns the text.
#[tauri::command]
pub fn sync_load(state: tauri::State<'_, AppState>, blocks: Vec<String>) -> Result<Value, String> {
    let mut guard = state.session.lock().map_err(|_| lock_error())?;
    load_blocks(&mut guard, &blocks)?;
    let projected: Vec<Value> = project_all(&guard.doc).iter().map(BlockOut::to_json).collect();
    Ok(json!({ "blocks": projected, "version": 0 }))
}

/// Apply a batch of operations against a session. This is the whole engine half of the bridge,
/// kept free of Tauri types so it can be driven and measured by tests.
pub fn apply_ops(session: &mut Session, ops: &[SyncOp]) -> Result<ApplyResult, String> {
    let started = Instant::now();
    let mut changed: BTreeSet<usize> = BTreeSet::new();

    for op in ops {
        match op.clone() {
            SyncOp::InsertText { block, offset, text } => {
                if text.is_empty() {
                    continue;
                }
                let at = position(&session.doc, block, offset)?;
                session.sel = wordcraft_engine::Selection::caret(at);
                session.run("text.insert", &json!({ "text": text })).map_err(cmd_error)?;
                changed.insert(block);
            }
            SyncOp::DeleteRange { from_block, from_offset, to_block, to_offset } => {
                let anchor = position(&session.doc, from_block, from_offset)?;
                let focus = position(&session.doc, to_block, to_offset)?;
                session.sel = wordcraft_engine::Selection { anchor, focus };
                // text.delete removes the selection and honours Track Changes, so a deletion
                // becomes a w:del revision in the engine rather than a raw splice.
                session.run("text.delete", &json!({})).map_err(cmd_error)?;
                changed.insert(from_block);
                changed.insert(to_block);
            }
            SyncOp::SetMark { block, from, to, mark, on } => {
                let command = match mark.as_str() {
                    "bold" => "format.bold",
                    "italic" => "format.italic",
                    other => return Err(format!("unsupported mark {}", other)),
                };
                let a = position(&session.doc, block, from)?;
                let b = position(&session.doc, block, to)?;
                if a == b {
                    continue;
                }
                // The engine's bold/italic commands toggle. Ask it only when toggling produces
                // the requested state; otherwise the reconciliation in the front end corrects
                // the view from the engine's own answer.
                if mark_state(&session, block, from, to, &mark) == Some(on) {
                    changed.insert(block);
                    continue;
                }
                session.sel = wordcraft_engine::Selection { anchor: a, focus: b };
                session.run(command, &json!({})).map_err(cmd_error)?;
                changed.insert(block);
            }
        }
    }

    let blocks: Vec<BlockOut> = changed.iter().filter_map(|i| project_block(&session.doc, *i)).collect();
    let caret = (session.sel.focus.path.depth() == 0).then(|| {
        let block = session.sel.focus.path.last();
        let offset = body_para(&session.doc, block).map_or(0, |p| byte_to_utf16(&p.text, session.sel.focus.off));
        (block, offset)
    });
    Ok(ApplyResult { blocks, caret, micros: started.elapsed().as_micros() as u64 })
}

/// Apply a batch of operations and return only what changed.
#[tauri::command]
pub fn sync_apply(state: tauri::State<'_, AppState>, ops: Vec<SyncOp>) -> Result<Value, String> {
    let mut session = state.session.lock().map_err(|_| lock_error())?;
    let result = apply_ops(&mut session, &ops)?;
    let projected: Vec<Value> = result.blocks.iter().map(BlockOut::to_json).collect();
    let caret = result.caret.map(|(block, offset)| json!({ "block": block, "offset": offset }));
    Ok(json!({ "blocks": projected, "caret": caret, "micros": result.micros }))
}

/// The whole projection, for resynchronising after a command that did not go through the
/// translator (undo, an engine-only command). Costs a full walk; the editing path never uses it.
#[tauri::command]
pub fn sync_snapshot(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let started = Instant::now();
    let guard = state.session.lock().map_err(|_| lock_error())?;
    let projected: Vec<Value> = project_all(&guard.doc).iter().map(BlockOut::to_json).collect();
    Ok(json!({ "blocks": projected, "micros": started.elapsed().as_micros() as u64 }))
}

/// Whether the whole range already carries `mark`.
fn mark_state(session: &Session, block: usize, from: usize, to: usize, mark: &str) -> Option<bool> {
    let para = body_para(&session.doc, block)?;
    let start = utf16_to_byte(&para.text, from)?;
    let end = utf16_to_byte(&para.text, to)?;
    if end <= start {
        return None;
    }
    let mut covered = 0usize;
    let mut marked = 0usize;
    let mut offset = 0usize;
    for run in &para.runs {
        let run_end = offset + run.len;
        let lo = start.max(offset);
        let hi = end.min(run_end);
        if hi > lo {
            covered += hi - lo;
            let on = match mark {
                "bold" => run.props.bold == Some(true),
                "italic" => run.props.italic == Some(true),
                _ => false,
            };
            if on {
                marked += hi - lo;
            }
        }
        offset = run_end;
    }
    (covered > 0).then(|| marked == covered)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_with(blocks: &[&str]) -> Session {
        let owned: Vec<String> = blocks.iter().map(|s| s.to_string()).collect();
        let mut session = Session::new(Document::new());
        load_blocks(&mut session, &owned).unwrap();
        session
    }

    fn block_text(session: &Session, index: usize) -> String {
        body_para(&session.doc, index).map(|p| p.text.clone()).unwrap_or_default()
    }

    #[test]
    fn utf16_offsets_handle_accents_and_emoji() {
        let text = "ñandú 👍 fin";
        // "ñ" is 1 UTF-16 unit and 2 bytes; "👍" is 2 UTF-16 units and 4 bytes.
        assert_eq!(utf16_to_byte(text, 0), Some(0));
        assert_eq!(utf16_to_byte(text, 1), Some("ñ".len()));
        assert_eq!(utf16_to_byte(text, 5), Some("ñandú".len()));
        assert_eq!(utf16_to_byte(text, 6), Some("ñandú ".len()));
        assert_eq!(utf16_to_byte(text, 8), Some("ñandú 👍".len()));
        assert_eq!(utf16_to_byte(text, text.encode_utf16().count()), Some(text.len()));
        // An offset inside the surrogate pair is refused, not rounded.
        assert_eq!(utf16_to_byte(text, 7), None);
        for units in 0..=text.encode_utf16().count() {
            if let Some(byte) = utf16_to_byte(text, units) {
                assert_eq!(byte_to_utf16(text, byte), units);
            }
        }
    }

    #[test]
    fn insert_text_round_trips_through_the_engine() {
        let mut session = session_with(&["Hola"]);
        let result = apply_ops(&mut session, &[SyncOp::InsertText { block: 0, offset: 4, text: " mundo".into() }]).unwrap();
        assert_eq!(block_text(&session, 0), "Hola mundo");
        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].runs.iter().map(|r| r.text.as_str()).collect::<String>(), "Hola mundo");
    }

    #[test]
    fn insert_at_the_start_and_middle_keeps_offsets_correct() {
        let mut session = session_with(&["mundo"]);
        apply_ops(&mut session, &[SyncOp::InsertText { block: 0, offset: 0, text: "Hola ".into() }]).unwrap();
        assert_eq!(block_text(&session, 0), "Hola mundo");
        apply_ops(&mut session, &[SyncOp::InsertText { block: 0, offset: 5, text: "gran ".into() }]).unwrap();
        assert_eq!(block_text(&session, 0), "Hola gran mundo");
    }

    #[test]
    fn accents_do_not_corrupt_the_document() {
        let mut session = session_with(&["canción"]);
        // Offset 7 is after "canción"; UTF-16 and byte offsets differ here.
        apply_ops(&mut session, &[SyncOp::InsertText { block: 0, offset: 7, text: " bonita".into() }]).unwrap();
        assert_eq!(block_text(&session, 0), "canción bonita");
    }

    #[test]
    fn delete_range_removes_exactly_the_requested_text() {
        let mut session = session_with(&["Hola mundo"]);
        apply_ops(
            &mut session,
            &[SyncOp::DeleteRange { from_block: 0, from_offset: 4, to_block: 0, to_offset: 10 }],
        )
        .unwrap();
        assert_eq!(block_text(&session, 0), "Hola");
    }

    #[test]
    fn set_mark_makes_the_range_bold() {
        let mut session = session_with(&["Hola mundo"]);
        apply_ops(
            &mut session,
            &[SyncOp::SetMark { block: 0, from: 0, to: 4, mark: "bold".into(), on: true }],
        )
        .unwrap();
        let projected = project_block(&session.doc, 0).unwrap();
        let bold: String = projected.runs.iter().filter(|r| r.bold).map(|r| r.text.as_str()).collect();
        assert_eq!(bold, "Hola");
    }

    #[test]
    fn a_caret_in_a_later_block_still_targets_the_right_paragraph() {
        let mut session = session_with(&["uno", "dos"]);
        apply_ops(&mut session, &[SyncOp::InsertText { block: 1, offset: 3, text: "!".into() }]).unwrap();
        // The other paragraph must be untouched; that is the property under test.
        assert_eq!(block_text(&session, 0), "uno");
        assert!(block_text(&session, 1).ends_with('!'), "got {:?}", block_text(&session, 1));
    }

    /// The engine, not the view, owns Word's typing rules. Typing at the end of a paragraph makes
    /// it capitalise the paragraph's first letter (AutoCorrect), and the view must show whatever
    /// the engine decided. This is the behaviour that made the block-targeting test above need a
    /// narrower assertion.
    #[test]
    fn autocorrect_is_applied_by_the_engine() {
        let mut session = session_with(&["dos"]);
        apply_ops(&mut session, &[SyncOp::InsertText { block: 0, offset: 3, text: "!".into() }]).unwrap();
        assert_eq!(block_text(&session, 0), "Dos!");

        let result = apply_ops(&mut session, &[SyncOp::InsertText { block: 0, offset: 4, text: " Dos".into() }]).unwrap();
        let projected: String = result.blocks[0].runs.iter().map(|r| r.text.as_str()).collect();
        // Whatever the engine produced is what the projection reports.
        assert_eq!(projected, block_text(&session, 0));
    }

    fn percentile(sorted: &[u64], p: f64) -> u64 {
        if sorted.is_empty() {
            return 0;
        }
        let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
        sorted[idx.min(sorted.len() - 1)]
    }

    /// The engine half of the typing loop. The bridge must add only transport on top of this.
    #[test]
    fn engine_apply_latency_is_within_a_frame() {
        let mut session = session_with(&["Escribir rápido"]);
        let mut samples: Vec<u64> = Vec::with_capacity(400);
        for i in 0..400u64 {
            let offset = (7 + i % 20) as usize;
            let ops = [SyncOp::InsertText { block: 0, offset, text: "a".into() }];
            let result = apply_ops(&mut session, &ops).unwrap();
            samples.push(result.micros);
        }
        samples.sort_unstable();
        let p50 = percentile(&samples, 0.50);
        let p95 = percentile(&samples, 0.95);
        let p99 = percentile(&samples, 0.99);
        println!("engine apply latency over {} edits: p50={}us p95={}us p99={}us max={}us", samples.len(), p50, p95, p99, samples.last().copied().unwrap_or(0));
        // A 60 fps frame is 16_666 us; the engine must be a small fraction of it.
        assert!(p95 < 8_000, "p95 was {p95}us");
    }
}
