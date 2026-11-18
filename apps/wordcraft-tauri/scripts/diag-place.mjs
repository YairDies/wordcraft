import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(20000);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(2000);

const MARK = "ZZMARK";
await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+End");
await page.keyboard.type(MARK);
await page.waitForTimeout(1500);

const state = await page.evaluate(async (mark) => {
  const snap = await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
  const engineBlocks = snap.blocks.map((b) => b.runs.map((r) => r.text).join(""));
  const viewBlocks = [...document.querySelectorAll(".ProseMirror > *")].map((n) => n.textContent ?? "");
  return {
    engineCount: engineBlocks.length,
    viewCount: viewBlocks.length,
    engineHit: engineBlocks.findIndex((t) => t.includes(mark)),
    viewHit: viewBlocks.findIndex((t) => t.includes(mark)),
    engineLast: engineBlocks.slice(-2),
    viewLast: viewBlocks.slice(-2),
    engineBlock0: engineBlocks[0]?.slice(0, 40),
    viewBlock0: viewBlocks[0]?.slice(0, 40),
    banners: [...document.querySelectorAll(".fui-MessageBarBody")].map((n) => n.textContent),
    samples: window.__wcSyncSamples ?? [],
  };
}, MARK);

console.log(JSON.stringify(state, null, 1));
await browser.close();
