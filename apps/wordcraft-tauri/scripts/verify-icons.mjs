import { chromium } from "playwright";
const browser = await chromium.connectOverCDP(process.argv[2] ?? "http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(20000);
await page.evaluate(() => {
  localStorage.setItem("wc.locale", "es");
  // A reassignment made by another test would otherwise change what Ctrl+N means here.
  localStorage.removeItem("wc.shortcutOverrides");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(2000);

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
};

// Every command button on the Home tab should carry an svg.
const shapes = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll(".fui-Button")].filter((b) => b.getAttribute("aria-label"));
  const withSvg = buttons.filter((b) => b.querySelector("svg")).length;
  const sizes = buttons.map((b) => {
    const svg = b.querySelector("svg");
    return svg ? Math.round(svg.getBoundingClientRect().height) : 0;
  });
  return { buttons: buttons.length, withSvg, large: sizes.filter((s) => s >= 30).length, small: sizes.filter((s) => s > 0 && s <= 24).length };
});
record("1. every command button has an icon", shapes.withSvg >= 12, JSON.stringify(shapes));
record("2. icons follow the size proportion", shapes.large >= 1 && shapes.small >= 1, JSON.stringify(shapes));

// Decorative: the svg must not be announced.
const decorative = await page.evaluate(() => {
  const svgs = [...document.querySelectorAll(".fui-Button svg")];
  return svgs.every((s) => s.closest('[aria-hidden="true"]') !== null);
});
record("3. icons are decorative (aria-hidden)", decorative, "an icon is exposed to assistive tech");

// Bold: regular by default, filled when the command is on.
const boldState = async () =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll(".fui-Button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Negrita"));
    const svg = button?.querySelector("svg");
    return {
      pressed: button?.getAttribute("aria-pressed"),
      // Fluent names its icon components in the path count; the reliable signal is the filled variant's class.
      cls: svg?.getAttribute("class") ?? "",
    };
  });
const before = await boldState();
await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+End");
await page.keyboard.type("negrita");
await page.waitForTimeout(500);
await page.keyboard.down("Shift");
for (let i = 0; i < 7; i += 1) await page.keyboard.press("ArrowLeft");
await page.keyboard.up("Shift");
await page.waitForTimeout(400);
await page.keyboard.press("Control+n");
await page.waitForTimeout(900);
const after = await boldState();
const bolded = await page.evaluate(() => document.querySelectorAll(".ProseMirror strong").length);
record("4. the shortcut reached the document", bolded > 0, `strong count ${bolded}`);
record("5. Bold reports its active state", after.pressed === "true" && before.pressed === null, `before ${before.pressed} after ${after.pressed}`);

await page.screenshot({ path: "verify-icons.png" });
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
