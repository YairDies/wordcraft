import { chromium } from "playwright";
const browser = await chromium.connectOverCDP(process.argv[2] ?? "http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(30000);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");

const probe = async (label) => {
  const s = await page.evaluate(() => {
    const mirror = document.querySelector(".ProseMirror");
    return {
      children: mirror ? mirror.children.length : -1,
      headings: document.querySelectorAll(".ProseMirror h1,.ProseMirror h2,.ProseMirror h3").length,
      tables: document.querySelectorAll(".ProseMirror table").length,
      lists: document.querySelectorAll(".ProseMirror ul,.ProseMirror ol").length,
    };
  });
  console.log(label, JSON.stringify(s));
  return s;
};

// Case A: sync disconnected before the import, so only importer + normalizer run.
await page.evaluate(() => { window.__wcDisableSync = true; });
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(2500);
const withoutSync = await probe("IMPORT WITH SYNC DISABLED:");

// Case B: sync connected, so the seed + reconcile path also runs.
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(3000);
const withSync = await probe("IMPORT WITH SYNC ENABLED :");

console.log("importer alone keeps the document:", withoutSync.children > 5 && withoutSync.tables === 1);
console.log("sync path destroys it:", withSync.children < withoutSync.children);
await browser.close();
