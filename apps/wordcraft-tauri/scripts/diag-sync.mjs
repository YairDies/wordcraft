import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(20000);

const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

await page.waitForSelector(".ProseMirror");
const before = await page.evaluate(() => ({
  hasTauri: "__TAURI_INTERNALS__" in window,
  text: document.querySelector(".ProseMirror")?.textContent?.slice(0, 80) ?? "",
  banners: [...document.querySelectorAll(".fui-MessageBarBody")].map((n) => n.textContent),
  samples: window.__wcSyncSamples?.length ?? -1,
}));
console.log("BEFORE:", JSON.stringify(before, null, 1));

await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+End");
await page.keyboard.type("abc");
await page.waitForTimeout(1500);

const after = await page.evaluate(() => ({
  text: document.querySelector(".ProseMirror")?.textContent?.slice(-60) ?? "",
  banners: [...document.querySelectorAll(".fui-MessageBarBody")].map((n) => n.textContent),
  samples: window.__wcSyncSamples ?? null,
}));
console.log("AFTER:", JSON.stringify(after, null, 1));
console.log("LOGS:", logs.slice(-10).join("\n"));
await browser.close();
