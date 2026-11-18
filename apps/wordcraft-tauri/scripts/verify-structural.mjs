/**
 * Acceptance test for structural editing under "the engine owns the document".
 *
 * Walks the path a person would: type a paragraph, press Enter, type another, join them again,
 * make a list, insert a table and type in a cell — then asks the ENGINE for its own document and
 * checks that every word survived, lists and table cells included.
 *
 * Attaches to the running app over CDP:
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 */
import { chromium } from "playwright";

const CDP = process.argv[2] ?? "http://127.0.0.1:9222";

function stats(values) {
  if (!values.length) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))];
  return { n: sorted.length, p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), p99: +at(0.99).toFixed(2) };
}

const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(30000);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(2500);

// The ribbon only renders the active tab, so a command has to be reached the way a person
// reaches it: switch to its tab, then press the button.
const clickTab = async (name) => {
  await page.getByRole("tab", { name, exact: true }).first().click();
  await page.waitForTimeout(300);
};

// Permanent regression guard: the import must land in the view complete. It once produced a
// single block because the document was handed to updateState instead of dispatched through the
// mounted view.
const imported = await page.evaluate(() => {
  const mirror = document.querySelector(".ProseMirror");
  return {
    children: mirror ? mirror.children.length : -1,
    headings: document.querySelectorAll(".ProseMirror h1,.ProseMirror h2,.ProseMirror h3").length,
    tables: document.querySelectorAll(".ProseMirror table").length,
    lists: document.querySelectorAll(".ProseMirror ul,.ProseMirror ol").length,
  };
});
const engineAfterImport = await page.evaluate(async () => {
  const snapshot = await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
  return { paragraphs: snapshot.blocks.length, nested: snapshot.blocks.filter((b) => b.path.length > 1).length };
});
console.log("=== IMPORT ===", JSON.stringify(imported), JSON.stringify(engineAfterImport));

const clickRibbon = async (labelPart, tab) => {
  if (tab) await clickTab(tab);
  const button = page.locator(`.ribbon-button[title*="${labelPart}"]`).first();
  await button.click({ timeout: 8000 });
  await page.waitForTimeout(600);
};

// --- paragraphs, Enter, and joining them again ---
await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type("PRIMERO alfa beta");
await page.keyboard.press("Enter");
await page.keyboard.type("SEGUNDO gamma delta");
await page.waitForTimeout(900);

const afterSplit = await page.evaluate(async () => {
  const snapshot = await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
  const text = snapshot.blocks.map((b) => b.runs.map((r) => r.text).join(""));
  return {
    paragraphs: text.length,
    hasFirst: text.some((t) => t.includes("PRIMERO alfa beta")),
    hasSecond: text.some((t) => t.includes("SEGUNDO gamma delta")),
    views: [...document.querySelectorAll(".ProseMirror > *")].length,
  };
});

// --- join them: Backspace at the start of the second paragraph ---
await page.keyboard.press("Home");
await page.keyboard.press("Backspace");
await page.waitForTimeout(900);

const afterJoin = await page.evaluate(async () => {
  const snapshot = await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
  const text = snapshot.blocks.map((b) => b.runs.map((r) => r.text).join(""));
  return { paragraphs: text.length, joined: text.some((t) => t.includes("PRIMERO alfa betaSEGUNDO gamma delta")) };
});

// --- a list with several items ---
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type("Item uno");
await page.keyboard.press("Enter");
await page.keyboard.type("Item dos");
await page.keyboard.press("Enter");
await page.keyboard.type("Item tres");
await page.waitForTimeout(600);

// Select the three items, then make them a bulleted list.
await page.keyboard.press("Shift+Home");
await page.keyboard.press("Shift+ArrowUp");
await page.keyboard.press("Shift+ArrowUp");
await clickRibbon("Bullets", "Home");
await page.waitForTimeout(900);

const afterList = await page.evaluate(async () => {
  const snapshot = await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
  const text = snapshot.blocks.map((b) => b.runs.map((r) => r.text).join(""));
  return {
    hasItems: ["Item uno", "Item dos", "Item tres"].every((item) => text.some((t) => t.includes(item))),
    listInView: document.querySelectorAll(".ProseMirror ul").length,
    paragraphs: text.length,
  };
});

// --- a table with text in a cell ---
await page.keyboard.press("Control+End");
await clickRibbon("Table", "Insert");   // the Insert tab labels it simply "Table"
await page.waitForTimeout(800);

const cells = page.locator(".ProseMirror table td").first();
await cells.click({ force: true });
await page.keyboard.type("CELDA texto");
// The engine is rebuilt from the view after a structural edit; let that round trip land.
await page.waitForTimeout(2500);

const final = await page.evaluate(async () => {
  const snapshot = await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
  const blocks = snapshot.blocks.map((b) => ({ path: b.path, text: b.runs.map((r) => r.text).join("") }));
  return {
    blocks,
    tablesInView: document.querySelectorAll(".ProseMirror table").length,
    samples: window.__wcSyncSamples ?? [],
    banners: [...document.querySelectorAll(".fui-MessageBarBody")].map((n) => n.textContent),
  };
});

const allText = final.blocks.map((b) => b.text).join("\n");
const cellsInEngine = final.blocks.filter((b) => b.path.length > 1);
const checks = {
  importLandsComplete: imported.children >= 11 && imported.headings >= 3 && imported.tables >= 1 && imported.lists >= 2,
  importReachesEngine: engineAfterImport.paragraphs >= 26 && engineAfterImport.nested >= 9,
  paragraphsSplit: afterSplit.hasFirst && afterSplit.hasSecond,
  engineSawSplit: afterSplit.paragraphs >= 3,
  paragraphsJoined: afterJoin.joined === true,
  listItemsInEngine: afterList.hasItems,
  listInView: afterList.listInView >= 1,
  tableInView: final.tablesInView >= 1,
  tableCellIsEngineParagraph: cellsInEngine.length >= 9,
  cellTextInEngine: allText.includes("CELDA texto"),
  engineHoldsEverything: allText.includes("PRIMERO alfa beta") && allText.includes("Item tres"),
};

console.log("=== SPLIT ===", JSON.stringify(afterSplit));
console.log("=== JOIN ===", JSON.stringify(afterJoin));
console.log("=== LIST ===", JSON.stringify(afterList));
console.log("=== TABLE CELL PARAGRAPHS IN ENGINE ===", cellsInEngine.length);
console.log("all engine paths:", JSON.stringify(final.blocks.map((b) => b.path)));
console.log("cell paragraphs:", JSON.stringify(cellsInEngine.slice(0, 4)));
console.log("engine paragraph texts:", JSON.stringify(final.blocks.map((b) => b.text.slice(0, 28))));
console.log("imported paragraphs present:", final.blocks.some((b) => b.text.includes("WordCraft Accessibility Sample")));
console.log("UI messages:", JSON.stringify(final.banners));
console.log("=== LATENCY (ms) ===");
console.log("confirmation round trip:", JSON.stringify(stats(final.samples.map((s) => s.roundTripMs))));
console.log("engine only:", JSON.stringify(stats(final.samples.map((s) => s.engineMs))));
console.log("=== CHECKS ===");
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
const ok = Object.values(checks).every(Boolean);
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
await page.screenshot({ path: "verify-structural.png" });
await browser.close();
process.exit(ok ? 0 : 1);
