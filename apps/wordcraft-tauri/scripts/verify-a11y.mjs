/**
 * Opens the built front end in the installed Chrome and checks that the editing surface really is
 * accessible and really editable:
 *
 *  1. the editable element carries role=textbox + aria-multiline, and the document's text is in
 *     the browser accessibility tree (what NVDA and Narrator consume), not merely on screen;
 *  2. typing inserts text, and the new text reaches the accessibility tree;
 *  3. Word's formatting shortcut (Ctrl+B) applies through the editor.
 *
 * Usage:  node scripts/verify-a11y.mjs [http://localhost:4173]
 * Needs a static server for dist/ (pnpm preview).
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:4173";
const TYPED = " Typed by the accessibility check.";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

await page.goto(base, { waitUntil: "networkidle" });
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForSelector(".ProseMirror", { timeout: 15000 });
await page.waitForTimeout(1200);

const dom = await page.evaluate(() => {
  const el = document.querySelector(".ProseMirror");
  if (!el) return { missing: true };
  return {
    contentEditable: el.getAttribute("contenteditable"),
    role: el.getAttribute("role"),
    ariaLabel: el.getAttribute("aria-label"),
    ariaMultiline: el.getAttribute("aria-multiline"),
    textLength: el.textContent?.length ?? 0,
    headings: el.querySelectorAll("h1,h2,h3").length,
    tables: el.querySelectorAll("table").length,
    bulletLists: el.querySelectorAll("ul").length,
    orderedLists: el.querySelectorAll("ol").length,
    bold: el.querySelectorAll("strong").length,
  };
});

const cdp = await context.newCDPSession(page);
await cdp.send("Accessibility.enable");
const before = await cdp.send("Accessibility.getFullAXTree");
const textbox = before.nodes.find((n) => n.role?.value === "textbox");
const exposesHeading = before.nodes.filter((n) => (n.name?.value ?? "").includes("WordCraft Accessibility Sample"));

await page.screenshot({ path: "verify-screenshot.png" });

// --- typing ---
await page.click(".ProseMirror");
await page.keyboard.press("Control+End");
await page.keyboard.type(TYPED);
await page.waitForTimeout(400);

const afterTyping = await page.evaluate((typed) => {
  const el = document.querySelector(".ProseMirror");
  return { hasTyped: (el?.textContent ?? "").includes(typed.trim()), textLength: el?.textContent?.length ?? 0 };
}, TYPED);

const afterAx = await cdp.send("Accessibility.getFullAXTree");
const typedInAx = afterAx.nodes.filter((n) => (n.name?.value ?? "").includes("Typed by the accessibility check"));
const textboxAfter = afterAx.nodes.find((n) => n.role?.value === "textbox");

// --- Ctrl+B at the caret: Word's behaviour is that formatting picked with a collapsed caret
// applies to the text typed next. Selecting the whole document instead would toggle the mark for
// the mixed selection, which says nothing about the shortcut reaching the editor.
await page.keyboard.press("Enter");
await page.keyboard.press("Control+b");
await page.keyboard.type("bold-run");
await page.keyboard.press("Control+b");
await page.waitForTimeout(300);
const boldApplied = await page.evaluate(() =>
  [...document.querySelectorAll(".ProseMirror strong")].some((el) => (el.textContent ?? "").includes("bold-run")),
);

await page.screenshot({ path: "verify-screenshot-typed.png" });
await browser.close();

console.log("=== DOM after import ===");
console.log(JSON.stringify(dom, null, 2));
console.log("=== ACCESSIBILITY TREE ===");
console.log("textbox:", textbox ? JSON.stringify({
  role: textbox.role?.value,
  name: textbox.name?.value,
  multiline: textbox.properties?.find((p) => p.name === "multiline")?.value?.value,
  readonly: textbox.properties?.find((p) => p.name === "readonly")?.value?.value,
}) : "NOT FOUND");
console.log("nodes exposing the heading:", exposesHeading.length, exposesHeading.map((n) => n.role?.value).join(", "));
console.log("=== TYPING ===");
console.log("typed text in document:", afterTyping.hasTyped, "(chars", dom.textLength, "->", afterTyping.textLength + ")");
console.log("typed text nodes in AX tree:", typedInAx.length, typedInAx.map((n) => n.role?.value).join(", "));
console.log("textbox still exposed after typing:", Boolean(textboxAfter));
console.log("=== FORMATTING SHORTCUT ===");
console.log("typed text wrapped in <strong> after Ctrl+B:", boldApplied);

const checks = {
  contentEditable: dom.contentEditable === "true",
  textboxRole: dom.role === "textbox",
  multiline: dom.ariaMultiline === "true",
  textPresent: (dom.textLength ?? 0) > 200,
  axTextbox: Boolean(textbox) && textbox?.name?.value === "Document text",
  axExposesText: exposesHeading.length > 0,
  typingWorks: afterTyping.hasTyped === true,
  typingInAxTree: typedInAx.length > 0,
  boldShortcut: boldApplied === true,
};
console.log("=== CHECKS ===");
for (const [name, value] of Object.entries(checks)) console.log(`${value ? "PASS" : "FAIL"}  ${name}`);
const ok = Object.values(checks).every(Boolean);
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);
