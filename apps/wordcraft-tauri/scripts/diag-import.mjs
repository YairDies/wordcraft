import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(20000);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(3000);

const state = await page.evaluate(async () => {
  const snapshot = await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
  const mirror = document.querySelector(".ProseMirror");
  const viewBlocks = mirror ? [...mirror.children].map((n) => n.nodeName + ":" + (n.textContent ?? "").slice(0, 18)) : [];
  return {
    engineCount: snapshot.blocks.length,
    engineDepths: snapshot.blocks.map((b) => b.path.length),
    enginePaths: snapshot.blocks.map((b) => b.path),
    viewBlocks,
    viewTables: document.querySelectorAll(".ProseMirror table").length,
    viewLists: document.querySelectorAll(".ProseMirror ul,.ProseMirror ol").length,
    banners: [...document.querySelectorAll(".fui-MessageBarBody")].map((n) => n.textContent),
  };
});
console.log(JSON.stringify(state, null, 1).slice(0, 2500));
await browser.close();
