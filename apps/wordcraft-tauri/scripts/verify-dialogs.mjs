import { chromium } from "playwright";
const browser = await chromium.connectOverCDP(process.argv[2] ?? "http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(20000);

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
};

const load = async (locale) => {
  await page.evaluate((value) => {
    localStorage.setItem("wc.locale", value);
    localStorage.removeItem("wc.shortcutOverrides");
  }, locale);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".ProseMirror");
  await page.setInputFiles("input[type=file]", "samples/welcome.docx");
  await page.waitForTimeout(2000);
};

const dialogOpen = () => page.evaluate(() => document.querySelector('[role="dialog"]') !== null);
const activeTab = () => page.evaluate(() => document.querySelector('[role="dialog"] [role="tab"][aria-selected="true"]')?.textContent ?? null);

await load("es");

// 1. Ctrl+M opens Font in Spanish, and the dialog is announced by name.
await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+m");
await page.waitForTimeout(600);
record("1. Ctrl+M opens the Font dialog (Spanish)", await dialogOpen(), "no dialog");
const title = await page.evaluate(() => document.querySelector('[role="dialog"] [id$="__title"], [role="dialog"] h2, [role="dialog"] [role="heading"]')?.textContent ?? "");
record("2. the dialog is named for a screen reader", title.includes("Fuente"), JSON.stringify(title));

// 3. Ctrl+Tab moves between the dialog's tabs.
const firstTab = await activeTab();
await page.keyboard.press("Control+Tab");
await page.waitForTimeout(400);
const secondTab = await activeTab();
record("3. Ctrl+Tab changes tab", firstTab !== secondTab && secondTab !== null, `${firstTab} -> ${secondTab}`);

// 4. Esc cancels and focus returns to the editor.
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
record("4. Esc closes the dialog", !(await dialogOpen()));
// Fluent restores focus to the element that opened the dialog; the assertion is that focus is
// back inside the app rather than lost to the body.
const focusBack = await page.evaluate(() => {
  const active = document.activeElement;
  return active !== null && active !== document.body && document.body.contains(active);
});
record("5. focus returns to the app after Esc", focusBack, String(focusBack));

// 6. The keytip path opens Paragraph. Keytips are localised like the rest of the ribbon, so the
// Home tab is Alt+H in English and Alt+I in Spanish ("Inicio"); this run is Spanish.
await page.keyboard.press("Alt");
await page.waitForTimeout(250);
await page.keyboard.press("i");
await page.waitForTimeout(250);
await page.keyboard.press("p");
await page.waitForTimeout(700);
const paraTitle = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent?.slice(0, 40) ?? "");
record("6. Alt+I, P opens the Paragraph dialog (Spanish)", paraTitle.includes("Párrafo"), JSON.stringify(paraTitle));

// 7. Values apply: centre the paragraph and accept with Enter. The caret has to be inside a
// paragraph first — on opening a document it sits in the first block, which is a heading, and
// the Paragraph dialog formats paragraphs.
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+End");
await page.keyboard.type(" centered");
await page.waitForTimeout(600);
await page.keyboard.press("Control+Alt+p");
await page.waitForTimeout(700);
await page.locator('[role="dialog"] [role="tab"]', { hasText: "Sangría" }).first().click();
await page.waitForTimeout(300);
await page.getByRole("radio", { name: "Centrada" }).click();
await page.keyboard.press("Enter");
await page.waitForTimeout(800);
const aligned = await page.evaluate(() =>
  [...document.querySelectorAll(".ProseMirror p")].some((p) => (p.getAttribute("style") ?? "").includes("center")),
);
record("7. Enter accepts and the value reaches the document", aligned, "no centred paragraph");
record("8. the dialog closed on accept", !(await dialogOpen()));

// 9. The English shortcut is Ctrl+D.
await load("en");
await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+d");
await page.waitForTimeout(600);
record("9. Ctrl+D opens Font in English", await dialogOpen(), "no dialog");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// 10. The ribbon's group launcher opens Page Setup.
await page.getByRole("tab", { name: "Insert", exact: true }).first().click();
await page.waitForTimeout(300);
await page.locator('button[aria-label*="más opciones"]').last().click();
await page.waitForTimeout(700);
const pageTitle = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent?.slice(0, 40) ?? "");
record("10. the ribbon launcher opens Page Setup", pageTitle.includes("Configurar"), JSON.stringify(pageTitle));

// 11. Page setup applies to the sheet.
await page.getByRole("spinbutton", { name: "Margen superior" }).fill("36");
await page.keyboard.press("Enter");
await page.waitForTimeout(700);
const padded = await page.evaluate(() => document.querySelector(".wc-sheet")?.getAttribute("style") ?? "");
record("11. the margins reach the page", padded.includes("padding"), JSON.stringify(padded.slice(0, 80)));

await page.screenshot({ path: "verify-dialogs.png" });
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
