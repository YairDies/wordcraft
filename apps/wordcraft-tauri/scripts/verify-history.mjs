/**
 * History under an authoritative engine.
 *
 * The engine owns the document, so the engine owns undo too: the shell's Undo runs edit.undo in
 * Rust and the view is corrected from the result. These cases pin that behaviour down, including
 * after the structural operations that the bridge now sends as engine commands.
 */
import { chromium } from "playwright";

const CDP = process.argv[2] ?? "http://127.0.0.1:9222";
const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(30000);

await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(2500);

const settle = (ms = 900) => page.waitForTimeout(ms);

const undo = async () => {
  await page.locator('button[aria-label="Undo"]').first().click();
  await settle();
};
const redo = async () => {
  await page.locator('button[aria-label="Redo"]').first().click();
  await settle();
};

const state = async () =>
  page.evaluate(async () => {
    const snapshot = await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
    const engine = snapshot.blocks.map((b) => b.runs.map((r) => r.text).join("")).join("");
    const view = document.querySelector(".ProseMirror")?.textContent ?? "";
    return { engine, view, paragraphs: snapshot.blocks.length };
  });

const clickTab = async (name) => {
  await page.getByRole("tab", { name, exact: true }).first().click();
  await page.waitForTimeout(300);
};
const clickRibbon = async (label, tab) => {
  if (tab) await clickTab(tab);
  await page.locator(".ribbon-button").filter({ hasText: new RegExp("^" + label + "$") }).first().click();
  await settle();
};

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
};

const normal = (s) => s.replace(/\s+/g, " ").trim();

// ---- 1 & 2: type, Enter, type in the window, undo, redo ----
await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+End");
await page.keyboard.type("ALFA uno");
await page.keyboard.press("Enter");
await page.keyboard.type("BETA dos");
await settle(1200);
const both = await state();
record("1a. both runs reach the engine", normal(both.engine).includes("ALFA uno") && normal(both.engine).includes("BETA dos"), JSON.stringify(normal(both.engine).slice(-80)));

await undo();
const afterUndo = await state();
record(
  "1b. undo removes the second run and keeps the first",
  normal(afterUndo.engine).includes("ALFA uno") && !normal(afterUndo.engine).includes("BETA dos"),
  JSON.stringify(normal(afterUndo.engine).slice(-80)),
);
record("6a. engine and view agree after undo", normal(afterUndo.engine) === normal(afterUndo.view), "engine/view differ");

await redo();
const afterRedo = await state();
record("2. redo restores both runs", normal(afterRedo.engine).includes("ALFA uno") && normal(afterRedo.engine).includes("BETA dos"), JSON.stringify(normal(afterRedo.engine).slice(-80)));
record("6b. engine and view agree after redo", normal(afterRedo.engine) === normal(afterRedo.view), "engine/view differ");

// ---- 3: undo after a merge ----
await page.keyboard.press("Control+End");
await page.keyboard.press("Home");
await page.keyboard.press("Backspace");
await settle(1200);
const merged = await state();
const mergedText = normal(merged.engine);
record("3a. backspace at a paragraph start joins them", merged.paragraphs < afterRedo.paragraphs, `paragraphs ${afterRedo.paragraphs} -> ${merged.paragraphs}`);

await undo();
const afterUnmerge = await state();
record("3b. undo separates them again", afterUnmerge.paragraphs === afterRedo.paragraphs && normal(afterUnmerge.engine) === normal(afterRedo.engine), `paragraphs ${afterUnmerge.paragraphs} vs ${afterRedo.paragraphs}`);

// ---- 4: undo after a list and after a table ----
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type("ITEM uno");
await settle(800);
const beforeList = await state();
await clickRibbon("Bullets", "Home");
const listed = await page.evaluate(() => document.querySelectorAll(".ProseMirror ul").length);
record("4a. bullets create a list", listed > 0, "no list in the view");
await undo();
const afterListUndo = await state();
record("4b. undo removes the list", normal(afterListUndo.engine) === normal(beforeList.engine), "engine text changed after undo");

const beforeTable = await state();
await clickRibbon("Table", "Insert");
const tabled = await page.evaluate(() => document.querySelectorAll(".ProseMirror table").length);
record("4c. table is inserted", tabled >= 1, "no table in the view");
await undo();
const afterTableUndo = await state();
record("4d. undo removes the table", afterTableUndo.paragraphs === beforeTable.paragraphs, `paragraphs ${afterTableUndo.paragraphs} vs ${beforeTable.paragraphs}`);

// ---- 5: chained undo ----
await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+End");
const chainBase = await state();
await page.keyboard.press("Enter");
await page.keyboard.type("GAMMA");
await settle(1000);
const chainTyped = await state();
await undo();
await undo();
const chainUndone = await state();
record(
  "5. two undos revert the typing and the split",
  chainUndone.paragraphs <= chainTyped.paragraphs && normal(chainUndone.engine) === normal(chainBase.engine),
  `engine differs from the base`,
);
record("6c. engine and view agree at the end", normal(chainUndone.engine) === normal(chainUndone.view), "engine/view differ");

await page.screenshot({ path: "verify-history.png" });
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(failed.length ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed.length ? 1 : 0);
