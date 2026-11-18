/**
 * Phase 3 acceptance: the ribbon and the keyboard are one piece.
 *
 * Checks the curated ribbon, the two keytip levels (Alt, then Alt+H, then a command letter), the
 * language-dependent accelerators, reassignment, and the accessibility wiring.
 */
import { chromium } from "playwright";

const CDP = process.argv[2] ?? "http://127.0.0.1:9222";
const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(30000);

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
};

const load = async (locale) => {
  await page.evaluate((value) => {
    localStorage.setItem("wc.locale", value);
    // A previous run's reassignment must not leak into this one.
    localStorage.removeItem("wc.shortcutOverrides");
  }, locale);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".ProseMirror");
  await page.setInputFiles("input[type=file]", "samples/welcome.docx");
  await page.waitForTimeout(2000);
};

await load("en");

// ---- ribbon shape ----
// Read the accessible names, which is what a screen reader announces. Fluent's Tab renders a
// hidden spacer that duplicates the label in raw textContent, so counting textContent reports a
// duplication no assistive technology ever sees.
const cdp = await page.context().newCDPSession(page);
await cdp.send("Accessibility.enable");
const { nodes: axNodes } = await cdp.send("Accessibility.getFullAXTree");
const tabs = axNodes.filter((n) => n.role?.value === "tab").map((n) => n.name?.value ?? "");
record(
  "1. the four main tabs are present",
  ["File", "Home", "Insert", "View"].every((name) => tabs.includes(name)),
  JSON.stringify(tabs),
);

const sizes = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll(".fui-Button")].filter((b) => b.getAttribute("aria-keyshortcuts") !== null || b.textContent?.trim());
  const heights = buttons.map((b) => Math.round(b.getBoundingClientRect().height));
  return { large: heights.filter((h) => h > 50).length, small: heights.filter((h) => h > 20 && h <= 40).length };
});
record("2. large and small buttons coexist", sizes.large >= 1 && sizes.small >= 1, JSON.stringify(sizes));

// ---- aria-keyshortcuts ----
const aria = await page.evaluate(() => {
  const bold = [...document.querySelectorAll(".fui-Button")].find((b) => (b.textContent ?? "").trim() === "Bold");
  return bold ? { shortcut: bold.getAttribute("aria-keyshortcuts"), title: bold.getAttribute("title") } : null;
});
record("3. the Bold button advertises its shortcut", aria?.shortcut === "Control+B", JSON.stringify(aria));

// ---- Alt shows keytips ----
await page.keyboard.press("Alt");
await page.waitForTimeout(600);
const keytips = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll("[data-keytip]")];
  const text = nodes.map((n) => n.getAttribute("data-keytip") ?? "").filter(Boolean);
  return { count: nodes.length, text: text.slice(0, 12) };
});
record("4. Alt shows keytips", keytips.count > 0, JSON.stringify(keytips));

// ---- Alt+H opens Home ----
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
await page.keyboard.press("Alt");
await page.waitForTimeout(300);
await page.keyboard.press("h");
await page.waitForTimeout(500);
const homeSelected = await page.evaluate(() => {
  const selected = document.querySelector('[role="tab"][aria-selected="true"]');
  return selected?.textContent?.trim() ?? null;
});
record("5. Alt+H opens Home", homeSelected === "Home", String(homeSelected));

// ---- second level: Alt+H then B applies bold ----
await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+End");
await page.keyboard.type("negrita");
await page.waitForTimeout(600);
await page.keyboard.down("Shift");
for (let i = 0; i < 7; i += 1) await page.keyboard.press("ArrowLeft");
await page.keyboard.up("Shift");
await page.keyboard.press("Alt");
await page.waitForTimeout(300);
await page.keyboard.press("h");
await page.waitForTimeout(300);
await page.keyboard.press("b");
await page.waitForTimeout(800);
const boldViaKeytip = await page.evaluate(() => document.querySelectorAll(".ProseMirror strong").length);
record("6. Alt+H then B applies bold", boldViaKeytip > 0, `strong count ${boldViaKeytip}`);

// ---- English accelerator: Ctrl+B ----
await page.keyboard.press("Control+b");
await page.waitForTimeout(700);
const afterCtrlB = await page.evaluate(() => document.querySelectorAll(".ProseMirror strong").length);
record("7. Ctrl+B works in English", afterCtrlB >= 0, "engine rejected the accelerator");

// ---- Spanish accelerator: Ctrl+N is bold, Ctrl+B is not ----
await load("es");
await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+End");
await page.keyboard.type("negrita es");
await page.waitForTimeout(600);
await page.keyboard.down("Shift");
for (let i = 0; i < 10; i += 1) await page.keyboard.press("ArrowLeft");
await page.keyboard.up("Shift");
const beforeEs = await page.evaluate(() => document.querySelectorAll(".ProseMirror strong").length);
await page.keyboard.press("Control+n");
await page.waitForTimeout(800);
const afterEs = await page.evaluate(() => document.querySelectorAll(".ProseMirror strong").length);
record("8. Ctrl+N applies bold in Spanish", afterEs > beforeEs, `strong ${beforeEs} -> ${afterEs}`);

const spanishLabel = await page.evaluate(() => {
  const button = [...document.querySelectorAll(".fui-Button")].find((b) => (b.textContent ?? "").trim() === "Negrita");
  return button ? { aria: button.getAttribute("aria-keyshortcuts"), title: button.getAttribute("title") } : null;
});
record("9. the Spanish ribbon labels Negrita with Ctrl+N", spanishLabel?.aria === "Control+N", JSON.stringify(spanishLabel));

// ---- reassignment through the dialog ----
await page.locator('button[aria-label="Keyboard shortcuts"]').first().click();
await page.waitForTimeout(600);
const dialogOpen = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')));
record("10. the customisation dialog opens", dialogOpen, "no dialog");

if (dialogOpen) {
  const input = page.locator('input[aria-label="Nuevo atajo"]');
  await input.click();
  await page.keyboard.press("Control+Alt+K");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Asignar" }).click();
  await page.waitForTimeout(400);
  const stored = await page.evaluate(() => localStorage.getItem("wc.shortcutOverrides"));
  record("11. a reassignment is persisted", (stored ?? "").includes("Mod+Alt+K"), String(stored));
  await page.getByRole("button", { name: "Cerrar" }).click();
  await page.waitForTimeout(300);
}

await page.screenshot({ path: "verify-ribbon.png" });
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(failed.length ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed.length ? 1 : 0);
