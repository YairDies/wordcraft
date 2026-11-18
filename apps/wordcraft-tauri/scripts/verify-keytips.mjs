import { chromium } from "playwright";
const browser = await chromium.connectOverCDP(process.argv[2] ?? "http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(20000);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(2000);

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
};

const badges = () => page.evaluate(() => document.querySelectorAll("[data-keytip]").length);

record("keytips start hidden", (await badges()) === 0);
await page.keyboard.press("Alt");
await page.waitForTimeout(300);
const root = await badges();
record("Alt shows the first level", root >= 4, `badges ${root}`);

await page.keyboard.press("Escape");
await page.waitForTimeout(300);
record("Esc leaves keytip mode", (await badges()) === 0);

// A click on the document must land while keytip mode is on: no overlay may swallow it.
await page.keyboard.press("Alt");
await page.waitForTimeout(300);
await page.click(".ProseMirror", { force: false, timeout: 5000 }).then(
  () => record("the document is clickable with keytips shown", true),
  (error) => record("the document is clickable with keytips shown", false, String(error).slice(0, 120)),
);

await page.keyboard.press("Escape");
await page.waitForTimeout(200);
await page.screenshot({ path: "verify-keytips.png" });
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
