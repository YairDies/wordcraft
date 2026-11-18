/**
 * Diagnostic: does the VIEW survive structural editing on its own?
 *
 * Imports a document (so the engine is seeded and paths exist), then disconnects the editor from
 * the engine entirely and performs the same structural sequence the acceptance test does. If the
 * view still degrades, the bug is in reconciliation and has nothing to do with re-seeding.
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP(process.argv[2] ?? "http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(30000);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(2500);

const snap = async (label) => {
  const state = await page.evaluate(() => {
    const mirror = document.querySelector(".ProseMirror");
    return {
      children: mirror ? mirror.children.length : -1,
      text: (mirror?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      tables: document.querySelectorAll(".ProseMirror table").length,
      lists: document.querySelectorAll(".ProseMirror ul,.ProseMirror ol").length,
      headings: document.querySelectorAll(".ProseMirror h1,.ProseMirror h2,.ProseMirror h3").length,
    };
  });
  console.log(label, JSON.stringify(state));
  return state;
};

const baseline = await snap("BASELINE (imported, still connected):");

// Disconnect the editor from the engine; from here only ProseMirror touches the document.
await page.evaluate(() => { window.__wcDisableSync = true; });

await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type(" PRIMERO");
await page.keyboard.press("Enter");
await page.keyboard.type(" SEGUNDO");
const afterSplit = await snap("AFTER Enter + typing:");

await page.keyboard.press("Home");
await page.keyboard.press("Backspace");
const afterJoin = await snap("AFTER join (Backspace at start):");

await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type("ITEM UNO");
await page.keyboard.press("Enter");
await page.keyboard.type("ITEM DOS");
await snap("AFTER list-ish typing:");

await page.getByRole("tab", { name: "Home", exact: true }).first().click();
const bullets = page.locator(".ribbon-button").filter({ hasText: /^Bullets$/ }).first();
if (await bullets.count()) {
  await bullets.click();
  await page.waitForTimeout(400);
}
const afterList = await snap("AFTER Bullets:");

await page.getByRole("tab", { name: "Insert", exact: true }).first().click();
const table = page.locator(".ribbon-button").filter({ hasText: /^Table$/ }).first();
if (await table.count()) {
  await table.click();
  await page.waitForTimeout(500);
}
const afterTable = await snap("AFTER Table:");

const preserved =
  afterTable.children >= baseline.children &&
  afterTable.tables === baseline.tables + 1 &&
  afterTable.text.length > baseline.text.length;

console.log("VIEW PRESERVED WITHOUT SYNC:", preserved);
console.log(preserved ? "RESULT: view survives → re-seed was the cause" : "RESULT: view degrades without any engine traffic → reconciliation bug");
await page.screenshot({ path: "diag-view.png" });
await browser.close();
process.exit(preserved ? 0 : 1);
