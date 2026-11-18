//! Engine-authoritative editing bridge.
//!
//! The Rust document is the only source of truth. ProseMirror is a projection: every edit becomes
//! engine operations, the engine applies them to its own document, and the answer is a *delta* —
//! only the blocks whose content changed, never the whole document.
//!
//! Blocks are addressed by **path**, the engine's own addressing scheme: `[3]` is the fourth
//! top-level paragraph, `[2, 0, 1, 0]` the paragraph inside row 0, cell 1, of the table at block
//! 2. That is what makes list items and table cells engine-owned instead of placeholders.
//!
//! Offsets on the wire are UTF-16 code units (what JavaScript and ProseMirror count); the engine
//! addresses text by UTF-8 byte offset. Every crossing of that boundary converts.
//!
//! Structural edits (splitting or joining paragraphs, lists, tables) are applied by re-seeding the
//! engine from the front end's document. The engine's copy stays complete at the cost of its undo
//! history for that one edit; see `docs/desktop-tauri-plan.md`.

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use wordcraft_doc::props::{CharProps, NumRef};
use wordcraft_doc::table::{Cell, Row, Table};
use wordcraft_doc::{para_block, Block, Document, Paragraph, Path, Pos, StoryRef};
use wordcraft_engine::{CmdError, Session};

use crate::AppState;

/// A block of the document as the front end describes it when seeding the engine.
///
/// Lists arrive flattened: every item is a paragraph carrying a numbering reference, which is how
/// OOXML models a list anyway (`w:numPr` sits on the paragraph, not on a nested container).
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SeedBlock {
    Para { text: String },
    Heading { text: String, level: u8 },
    List { ordered: bool, items: Vec<String> },
    Table { rows: Vec<Vec<String>> },
}

/// One editing operation. Snake_case matches Rust exactly; this protocol is private to the bridge.
/// One editing operation.
///
/// Text operations carry **no position**: the engine keeps the cursor (its `Selection`) between
/// calls, exactly as Word's document object does, and acts where that cursor is. Operations used
/// to carry a block path, which meant every keystroke depended on a mapping that a concurrent
/// structural edit could invalidate — the class of bug that cost three cycles. Only the two
/// operations that *move* the cursor still name a position, and they are issued when the person
/// clicks or moves, not when they type.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op")]
pub enum SyncOp {
    /// Put the cursor at a position.
    CursorMove { path: Vec<u32>, offset: usize },
    /// Select from one position to another (a drag or Shift+arrow).
    SelectRange { from_path: Vec<u32>, from_offset: usize, to_path: Vec<u32>, to_offset: usize },
    /// Type: insert at the engine's cursor.
    InsertText { text: String },
    /// Backspace: delete the character before the cursor, joining paragraphs at a paragraph start.
    DeleteBack {},
    /// Delete: delete the character after the cursor, joining the next paragraph at a paragraph end.
    DeleteForward {},
    /// Delete the current selection.
    DeleteSelection {},
    /// Enter: split the paragraph at the cursor.
    SplitBlock {},
    /// Toggle a character mark over the current selection.
    SetMark { mark: String, on: bool },
}

/// A paragraph as the engine projects it.
#[derive(Clone, Debug)]
pub struct BlockOut {
    pub path: Vec<u32>,
    pub runs: Vec<RunOut>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOut {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
}

/// The document as a tree, which is what the front end needs to rebuild the view.
///
/// The flat path projection is enough for incremental edits, but a structural change adds or
/// removes paragraphs, and the view cannot be corrected without knowing what the document now
/// looks like: which paragraphs are headings, which belong to a list, how a table is shaped.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProjectedBlock {
    Para { runs: Vec<RunOut> },
    Heading { level: u8, runs: Vec<RunOut> },
    List { ordered: bool, items: Vec<Vec<RunOut>> },
    Table { rows: Vec<Vec<Vec<Vec<RunOut>>>> },
}

/// Runs of one paragraph.
fn runs_of(para: &Paragraph) -> Vec<RunOut> {
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
                        strike: props.strike == Some(true) || props.double_strike == Some(true),
                    });
                }
            }
        }
        start = end;
    }
    if start < para.text.len() {
        if let Some(rest) = para.text.get(floor_char_boundary(&para.text, start)..) {
            if !rest.is_empty() {
                runs.push(RunOut { text: rest.to_string(), bold: false, italic: false, underline: false, strike: false });
            }
        }
    }
    runs
}

/// The engine's document as a tree the front end can turn back into an editor document.
///
/// Consecutive numbered paragraphs are grouped into a list, as OOXML stores them; a paragraph with
/// an outline level is a heading; a table keeps its rows, cells and the paragraphs inside them.
pub fn project_structure(doc: &Document) -> Vec<ProjectedBlock> {
    let mut out: Vec<ProjectedBlock> = Vec::new();
    let Some(blocks) = doc.story(StoryRef::Body) else { return out };

    // Numbering ids 1 and 2 are what the seed writes for bullets and numbers.
    let mut open_list: Option<(bool, Vec<Vec<RunOut>>)> = None;
    let flush = |open: &mut Option<(bool, Vec<Vec<RunOut>>)>, out: &mut Vec<ProjectedBlock>| {
        if let Some((ordered, items)) = open.take() {
            if !items.is_empty() {
                out.push(ProjectedBlock::List { ordered, items });
            }
        }
    };

    for block in blocks.iter() {
        match &**block {
            Block::Para(para) => {
                if let Some(num) = para.props.numbering {
                    let ordered = num.num == 2;
                    match &mut open_list {
                        Some((open_ordered, items)) if *open_ordered == ordered => items.push(runs_of(para)),
                        Some(_) => {
                            flush(&mut open_list, &mut out);
                            open_list = Some((ordered, vec![runs_of(para)]));
                        }
                        None => open_list = Some((ordered, vec![runs_of(para)])),
                    }
                    continue;
                }
                flush(&mut open_list, &mut out);
                match para.props.outline_level {
                    Some(level) => out.push(ProjectedBlock::Heading { level: level.saturating_add(1).clamp(1, 9), runs: runs_of(para) }),
                    None => out.push(ProjectedBlock::Para { runs: runs_of(para) }),
                }
            }
            Block::Table(table) => {
                flush(&mut open_list, &mut out);
                let mut rows = Vec::with_capacity(table.rows.len());
                for row in &table.rows {
                    let mut cells = Vec::with_capacity(row.cells.len());
                    for cell in &row.cells {
                        let mut paragraphs = Vec::new();
                        for inner in cell.blocks.iter() {
                            if let Block::Para(p) = &**inner {
                                paragraphs.push(runs_of(p));
                            }
                        }
                        cells.push(paragraphs);
                    }
                    rows.push(cells);
                }
                out.push(ProjectedBlock::Table { rows });
            }
        }
    }
    flush(&mut open_list, &mut out);
    out
}

impl BlockOut {
    fn to_json(&self) -> Value {
        let runs: Vec<Value> = self
            .runs
            .iter()
            .map(|r| {
                json!({
                    "text": r.text,
                    "bold": r.bold,
                    "italic": r.italic,
                    "underline": r.underline,
                    "strike": r.strike,
                })
            })
            .collect();
        json!({ "path": self.path, "runs": runs })
    }
}

pub struct ApplyResult {
    pub blocks: Vec<BlockOut>,
    /// Time spent inside the engine, in microseconds.
    pub micros: u64,
}

fn lock_error() -> String {
    "the editing session is unavailable (a command failed earlier)".to_string()
}

fn cmd_error(e: CmdError) -> String {
    e.to_string()
}

/// Largest valid char boundary at or below `byte` (`str::floor_char_boundary` is unstable).
fn floor_char_boundary(text: &str, byte: usize) -> usize {
    let mut i = byte.min(text.len());
    while i > 0 && !text.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// UTF-16 code units (JavaScript) to UTF-8 bytes (the engine).
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

fn path_of(raw: &[u32]) -> Path {
    Path(raw.to_vec())
}

fn show(path: &[u32]) -> String {
    path.iter().map(u32::to_string).collect::<Vec<_>>().join("/")
}

/// An engine position for a (path, UTF-16 offset) pair.
fn position(doc: &Document, path: &[u32], offset: usize) -> Result<Pos, String> {
    let p = path_of(path);
    let para = doc.para(StoryRef::Body, &p).ok_or_else(|| format!("no paragraph at path {}", show(path)))?;
    let byte = utf16_to_byte(&para.text, offset).ok_or_else(|| format!("offset {} splits a character at {}", offset, show(path)))?;
    Ok(Pos { story: StoryRef::Body, path: p, off: byte })
}

/// Project one paragraph from the canonical document.
pub fn project(doc: &Document, path: &Path) -> Option<BlockOut> {
    let para = doc.para(StoryRef::Body, path)?;
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
                        strike: props.strike == Some(true) || props.double_strike == Some(true),
                    });
                }
            }
        }
        start = end;
    }
    if start < para.text.len() {
        if let Some(rest) = para.text.get(floor_char_boundary(&para.text, start)..) {
            if !rest.is_empty() {
                runs.push(RunOut { text: rest.to_string(), bold: false, italic: false, underline: false, strike: false });
            }
        }
    }
    Some(BlockOut { path: path.0.clone(), runs })
}

/// Every paragraph the engine holds, in document order (tables descended).
pub fn project_all(doc: &Document) -> Vec<BlockOut> {
    doc.para_paths(StoryRef::Body).into_iter().filter_map(|p| project(doc, &p)).collect()
}

/// Build the canonical document from the blocks the front end describes.
///
/// A list becomes consecutive top-level paragraphs carrying numbering (`w:numPr` on the
/// paragraph, as OOXML has it); a table becomes a real table whose cells hold real paragraphs.
/// Nothing is left as a placeholder, so the engine's document is complete: saving from it cannot
/// lose list or table text.
pub fn build_document(blocks: &[SeedBlock]) -> Result<Document, String> {
    let mut doc = Document::new();
    {
        let story = doc.story_mut(StoryRef::Body).map_err(|e| e.to_string())?;
        story.clear();
        for block in blocks {
            match block {
                SeedBlock::Para { text } => {
                    story.push(Arc::new(Block::Para(Paragraph::with_text(text, CharProps::default()))));
                }
                SeedBlock::Heading { text, level } => {
                    let mut p = Paragraph::with_text(text, CharProps::default());
                    p.props.outline_level = Some((*level).clamp(1, 9).saturating_sub(1));
                    story.push(Arc::new(Block::Para(p)));
                }
                SeedBlock::List { ordered, items } => {
                    // num 1 = bullets, num 2 = numbers.
                    let num = if *ordered { 2 } else { 1 };
                    for item in items {
                        let mut p = Paragraph::with_text(item, CharProps::default());
                        p.props.numbering = Some(NumRef { num, level: 0 });
                        story.push(Arc::new(Block::Para(p)));
                    }
                }
                SeedBlock::Table { rows } => {
                    let mut table_rows = Vec::with_capacity(rows.len());
                    for row in rows {
                        let cells = row.iter().map(|text| Cell::with_text(text)).collect();
                        table_rows.push(Row { props: Default::default(), cells, controls: Default::default() });
                    }
                    let table = Table { props: Default::default(), grid: Vec::new(), rows: table_rows, controls: Default::default() };
                    story.push(Arc::new(Block::Table(table)));
                }
            }
        }
        if story.is_empty() {
            story.push(para_block(Paragraph::new()));
        }
    }
    Ok(doc)
}

/// Replace a session's document from a structured description.
pub fn load_seed(session: &mut Session, blocks: &[SeedBlock]) -> Result<(), String> {
    let doc = build_document(blocks)?;
    *session = Session::new(doc);
    Ok(())
}

/// Apply a batch of operations against a session: the whole engine half of the bridge, kept free
/// of Tauri types so tests can drive and measure it.
pub fn apply_ops(session: &mut Session, ops: &[SyncOp]) -> Result<ApplyResult, String> {
    let started = Instant::now();
    let mut changed: BTreeSet<Vec<u32>> = BTreeSet::new();

    for op in ops {
        // Every paragraph the cursor touches is one whose projection may have changed: where it
        // starts and where it ends.
        let before = selection_paths(session);
        match op.clone() {
            SyncOp::CursorMove { path, offset } => {
                let at = position(&session.doc, &path, offset)?;
                session.sel = wordcraft_engine::Selection::caret(at);
            }
            SyncOp::SelectRange { from_path, from_offset, to_path, to_offset } => {
                let anchor = position(&session.doc, &from_path, from_offset)?;
                let focus = position(&session.doc, &to_path, to_offset)?;
                session.sel = wordcraft_engine::Selection { anchor, focus };
            }
            SyncOp::InsertText { text } => {
                if text.is_empty() {
                    continue;
                }
                session.run("text.insert", &json!({ "text": text })).map_err(cmd_error)?;
            }
            SyncOp::DeleteBack {} => {
                session.run("text.backspace", &json!({})).map_err(cmd_error)?;
            }
            SyncOp::DeleteForward {} => {
                session.run("text.delete", &json!({})).map_err(cmd_error)?;
            }
            SyncOp::DeleteSelection {} => {
                session.run("text.delete", &json!({})).map_err(cmd_error)?;
            }
            SyncOp::SplitBlock {} => {
                // Enter: the engine splits its own paragraph at its own cursor.
                session.run("text.newParagraph", &json!({})).map_err(cmd_error)?;
            }
            SyncOp::SetMark { mark, .. } => {
                let command = match mark.as_str() {
                    "bold" => "format.bold",
                    "italic" => "format.italic",
                    "underline" => "format.underline",
                    "strike" => "format.strikethrough",
                    other => return Err(format!("unsupported mark {}", other)),
                };
                if session.sel.is_collapsed() {
                    continue;
                }
                session.run(command, &json!({})).map_err(cmd_error)?;
            }
        }
        for path in before.into_iter().chain(selection_paths(session)) {
            changed.insert(path);
        }
    }

    let blocks: Vec<BlockOut> = changed.iter().filter_map(|p| project(&session.doc, &path_of(p))).collect();
    Ok(ApplyResult { blocks, micros: started.elapsed().as_micros() as u64 })
}

/// The paragraphs the current selection touches.
fn selection_paths(session: &Session) -> Vec<Vec<u32>> {
    vec![session.sel.anchor.path.0.clone(), session.sel.focus.path.0.clone()]
}

/// Whether the whole range already carries `mark`.
fn mark_state(session: &Session, path: &[u32], from: usize, to: usize, mark: &str) -> Option<bool> {
    let para = session.doc.para(StoryRef::Body, &path_of(path))?;
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
                "underline" => run.props.underline.is_some(),
                "strike" => run.props.strike == Some(true) || run.props.double_strike == Some(true),
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

/// Seed the canonical document and answer with its whole projection.
#[tauri::command]
pub fn sync_load(state: tauri::State<'_, AppState>, blocks: Vec<SeedBlock>) -> Result<Value, String> {
    let started = Instant::now();
    let mut guard = state.session.lock().map_err(|_| lock_error())?;
    load_seed(&mut guard, &blocks)?;
    let projected: Vec<Value> = project_all(&guard.doc).iter().map(BlockOut::to_json).collect();
    Ok(json!({ "blocks": projected, "micros": started.elapsed().as_micros() as u64 }))
}

/// Apply a batch of operations and return what changed.
///
/// When `structural` is set the document gained or lost a block, so the flat delta is useless to
/// the view: the answer carries the whole structure, the new block paths and the caret, and the
/// front end rebuilds from that in the same reply. Nothing is read afterwards, so there is no
/// window where the view holds stale indices.
#[tauri::command]
pub fn sync_apply(state: tauri::State<'_, AppState>, ops: Vec<SyncOp>, structural: Option<bool>) -> Result<Value, String> {
    let mut session = state.session.lock().map_err(|_| lock_error())?;
    let result = apply_ops(&mut session, &ops)?;
    let projected: Vec<Value> = result.blocks.iter().map(BlockOut::to_json).collect();
    // Every answer carries the cursor: the front end compares it with what it believes and sends
    // a CursorMove only when they differ, so typing never depends on a position it computed.
    let caret = {
        let focus = session.sel.focus.clone();
        let offset = session
            .doc
            .para(StoryRef::Body, &focus.path)
            .map_or(0, |p| byte_to_utf16(&p.text, focus.off));
        json!({ "path": focus.path.0, "offset": offset })
    };
    if structural.unwrap_or(false) {
        let structure = project_structure(&session.doc);
        let paths: Vec<Vec<u32>> = project_all(&session.doc).into_iter().map(|b| b.path).collect();
        return Ok(json!({
            "blocks": projected,
            "micros": result.micros,
            "structure": structure,
            "paths": paths,
            "caret": caret,
        }));
    }
    Ok(json!({ "blocks": projected, "micros": result.micros, "caret": caret }))
}

/// The whole projection, for resynchronising after a command that bypassed the translator.
#[tauri::command]
pub fn sync_snapshot(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let started = Instant::now();
    let guard = state.session.lock().map_err(|_| lock_error())?;
    let projected: Vec<Value> = project_all(&guard.doc).iter().map(BlockOut::to_json).collect();
    Ok(json!({ "blocks": projected, "micros": started.elapsed().as_micros() as u64 }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_with(blocks: Vec<SeedBlock>) -> Session {
        let mut session = Session::new(Document::new());
        load_seed(&mut session, &blocks).unwrap();
        session
    }

    fn para(text: &str) -> SeedBlock {
        SeedBlock::Para { text: text.to_string() }
    }

    fn block_text(session: &Session, path: &[u32]) -> String {
        session.doc.para(StoryRef::Body, &path_of(path)).map(|p| p.text.clone()).unwrap_or_default()
    }

    fn caret(block: usize, offset: usize) -> SyncOp {
        SyncOp::CursorMove { path: vec![block as u32], offset }
    }

    fn type_text(session: &mut Session, text: &str) {
        apply_ops(session, &[SyncOp::InsertText { text: text.to_string() }]).unwrap();
    }

    #[test]
    fn utf16_offsets_handle_accents_and_emoji() {
        let text = "ñandú 👍 fin";
        assert_eq!(utf16_to_byte(text, 1), Some("ñ".len()));
        assert_eq!(utf16_to_byte(text, 5), Some("ñandú".len()));
        assert_eq!(utf16_to_byte(text, 8), Some("ñandú 👍".len()));
        assert_eq!(utf16_to_byte(text, 7), None);
        for units in 0..=text.encode_utf16().count() {
            if let Some(byte) = utf16_to_byte(text, units) {
                assert_eq!(byte_to_utf16(text, byte), units);
            }
        }
    }

    /// The whole point of the cursor model: a text operation names no position at all.
    #[test]
    fn typing_goes_to_the_engine_cursor() {
        let mut session = session_with(vec![para("Hola")]);
        apply_ops(&mut session, &[caret(0, 4)]).unwrap();
        type_text(&mut session, " mundo");
        assert_eq!(block_text(&session, &[0]), "Hola mundo");
        apply_ops(&mut session, &[caret(0, 0)]).unwrap();
        type_text(&mut session, "> ");
        assert_eq!(block_text(&session, &[0]), "> Hola mundo");
    }

    #[test]
    fn backspace_joins_paragraphs_at_a_paragraph_start() {
        let mut session = session_with(vec![para("uno"), para("dos")]);
        apply_ops(&mut session, &[caret(1, 0)]).unwrap();
        apply_ops(&mut session, &[SyncOp::DeleteBack {}]).unwrap();
        assert_eq!(session.doc.para_paths(StoryRef::Body).len(), 1);
        assert_eq!(block_text(&session, &[0]), "unodos");
    }

    #[test]
    fn enter_splits_at_the_cursor_and_moves_it() {
        let mut session = session_with(vec![para("unodos")]);
        apply_ops(&mut session, &[caret(0, 3)]).unwrap();
        apply_ops(&mut session, &[SyncOp::SplitBlock {}]).unwrap();
        // The engine capitalises a paragraph's first letter (AutoCorrect), so the split text is
        // compared case-insensitively: the property under test is where the split happened.
        assert_eq!(block_text(&session, &[0]).to_lowercase(), "uno");
        assert_eq!(block_text(&session, &[1]), "dos");
        // The cursor follows the split into the new paragraph, at its start — Word's behaviour:
        // what you type next opens the new paragraph.
        type_text(&mut session, "!");
        assert_eq!(block_text(&session, &[1]), "!dos");
    }

    #[test]
    fn marks_apply_to_the_selection_the_engine_holds() {
        let mut session = session_with(vec![para("Hola mundo")]);
        apply_ops(
            &mut session,
            &[SyncOp::SelectRange { from_path: vec![0], from_offset: 0, to_path: vec![0], to_offset: 4 }],
        )
        .unwrap();
        apply_ops(&mut session, &[SyncOp::SetMark { mark: "bold".into(), on: true }]).unwrap();
        let projected = project(&session.doc, &path_of(&[0])).unwrap();
        let bold: String = projected.runs.iter().filter(|r| r.bold).map(|r| r.text.as_str()).collect();
        assert_eq!(bold, "Hola");
    }

    #[test]
    fn list_items_and_table_cells_are_real_text() {
        let session = session_with(vec![
            para("Antes"),
            SeedBlock::List { ordered: false, items: vec!["alfa".into(), "beta".into()] },
            SeedBlock::Table { rows: vec![vec!["A".into(), "B".into()]] },
        ]);
        assert_eq!(block_text(&session, &[1]), "alfa");
        assert_eq!(block_text(&session, &[2]), "beta");
        assert_eq!(block_text(&session, &[3, 0, 0, 0]), "A");
        let item = session.doc.para(StoryRef::Body, &path_of(&[1])).unwrap();
        assert!(item.props.numbering.is_some());
    }

    /// The cursor survives a structural change, which is what makes typing after Enter safe.
    #[test]
    fn cursor_survives_structural_operations() {
        let mut session = session_with(vec![para("alpha"), para("beta")]);
        apply_ops(&mut session, &[caret(0, 5)]).unwrap();
        apply_ops(&mut session, &[SyncOp::SplitBlock {}]).unwrap();
        type_text(&mut session, "X");
        assert_eq!(block_text(&session, &[1]), "X");
        assert_eq!(block_text(&session, &[2]), "beta");
    }

    fn percentile(sorted: &[u64], p: f64) -> u64 {
        if sorted.is_empty() {
            return 0;
        }
        let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
        sorted[idx.min(sorted.len() - 1)]
    }

    #[test]
    fn engine_apply_latency_is_within_a_frame() {
        let mut session = session_with(vec![para("Escribir rápido")]);
        apply_ops(&mut session, &[caret(0, 7)]).unwrap();
        let mut samples: Vec<u64> = Vec::with_capacity(400);
        for _ in 0..400u64 {
            let result = apply_ops(&mut session, &[SyncOp::InsertText { text: "a".into() }]).unwrap();
            samples.push(result.micros);
        }
        samples.sort_unstable();
        println!(
            "engine apply latency over {} edits: p50={}us p95={}us p99={}us",
            samples.len(),
            percentile(&samples, 0.50),
            percentile(&samples, 0.95),
            percentile(&samples, 0.99)
        );
        assert!(percentile(&samples, 0.95) < 8_000);
    }
}
