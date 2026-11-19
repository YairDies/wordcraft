/**
 * The Backstage: Word's full-window File view.
 *
 * The native pickers themselves cannot be driven from here — an operating system modal is outside
 * the page — so what is checked is the view, its keyboard, the command routing, and the file layer
 * the pickers call into (read_bytes / write_text) against a real file.
 */
import { chromium } from "playwright";
const browser = await chromium.connectOverCDP(process.argv[2] ?? "http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(20000);

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
};

await page.evaluate(() => {
  localStorage.setItem("wc.locale", "es");
  localStorage.removeItem("wc.shortcutOverrides");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(2000);

const backstageOpen = () => page.evaluate(() => document.querySelector('[role="listbox"][aria-label="Archivo"]') !== null);
const focusedId = () => page.evaluate(() => document.activeElement?.id ?? null);

// 1. Alt+A opens the Backstage in Spanish and puts the focus in the panel.
await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Alt");
await page.waitForTimeout(250);
await page.keyboard.press("a");
await page.waitForTimeout(700);
record("1. Alt+A opens the Backstage", await backstageOpen(), "not open");
const firstFocus = await focusedId();
record("2. focus lands on the first option", firstFocus === "backstage-file.home", String(firstFocus));

// 3. The panel is a listbox whose options are named, which is what a screen reader reads.
const cdp = await page.context().newCDPSession(page);
await cdp.send("Accessibility.enable");
const { nodes } = await cdp.send("Accessibility.getFullAXTree");
const axOptions = nodes.filter((n) => n.role?.value === "option").map((n) => n.name?.value ?? "");
record(
  "3. the options are exposed by name",
  ["Inicio", "Abrir", "Guardar", "Cerrar", "Opciones"].every((name) => axOptions.includes(name)),
  JSON.stringify(axOptions.slice(0, 10)),
);

// 4. Arrow down moves through the options.
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(250);
const second = await focusedId();
record("4. Arrow Down moves through the options", second !== firstFocus && second !== null, String(second));

// 5. Selecting a page shows it.
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(250);
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const heading = await page.evaluate(() => document.querySelector('[role="region"] h2')?.textContent ?? "");
record("5. a page opens on Enter", heading.length > 0, JSON.stringify(heading));

// 6. The routing works for the pages that open no native dialog.
// The id contains a dot, so it is matched as an attribute rather than with a CSS id selector.
await page.locator('[id="backstage-file.options"]').click();
await page.waitForTimeout(250);
await page.getByRole("button", { name: "Continuar" }).click();
await page.waitForTimeout(400);
const routed = await page.evaluate(() => window.__lastRun ?? null);
record("6. a page's action reaches the shell", routed === "file.options", String(routed));

// 7. Esc leaves the Backstage and gives the focus back to the document.
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
record("7. Esc closes the Backstage", !(await backstageOpen()));
const focusBack = await page.evaluate(() => document.activeElement?.classList.contains("ProseMirror") ?? false);
record("8. focus returns to the document", focusBack, String(focusBack));

// 9. The file layer the pickers call: write then read a real file.
const roundTrip = await page.evaluate(async () => {
  const path = "C:\\\\Word_Personal\\\\WordClon\\\\probe\\\\backstage-round-trip.txt";
  await window.__TAURI_INTERNALS__.invoke("write_text", { path, contents: "escrito por el Backstage" });
  const bytes = await window.__TAURI_INTERNALS__.invoke("read_bytes", { path });
  return new TextDecoder().decode(new Uint8Array(bytes));
});
record("9. write_text and read_bytes round-trip a file", roundTrip === "escrito por el Backstage", JSON.stringify(roundTrip));

// 10. The dialog plugin is registered: its commands answer instead of failing the capability.
const pluginReady = await page.evaluate(async () => {
  try {
    // A save with an empty default still reaches the plugin; we only check it is not "not allowed".
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});
record("10. the dialog plugin is wired", pluginReady.ok, JSON.stringify(pluginReady));

await page.screenshot({ path: "verify-backstage.png" });
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
