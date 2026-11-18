/**
 * Isolated latency diagnostic: typing only.
 *
 * No Enter, no joining, no deleting across paragraphs — so no re-seed ever runs. This isolates
 * what the bridge costs per keystroke, and whether mounting ProseMirror uncontrolled (out of
 * React's render path) actually moved the confirmation time.
 */
import { chromium } from "playwright";

const CDP = process.argv[2] ?? "http://127.0.0.1:9222";
const TEXT = "Escribo rápido con acentos: ñandú, canción, jamón y niño.";

function stats(values) {
  if (!values.length) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))];
  return { n: sorted.length, p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), p99: +at(0.99).toFixed(2), max: +sorted[sorted.length - 1].toFixed(2) };
}

const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts().flatMap((c) => c.pages())[0];
page.setDefaultTimeout(30000);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".ProseMirror");
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(2500);

// Perceived latency: key event -> the document's DOM actually changing.
await page.evaluate(() => {
  window.__wcPerceived = [];
  const el = document.querySelector(".ProseMirror");
  if (!el) return;
  let keyAt = 0;
  el.addEventListener("keydown", () => { keyAt = performance.now(); }, true);
  new MutationObserver(() => {
    if (!keyAt) return;
    window.__wcPerceived.push(performance.now() - keyAt);
    keyAt = 0;
  }).observe(el, { subtree: true, childList: true, characterData: true });
});

await page.click(".ProseMirror", { force: true });
await page.keyboard.press("Control+End");

// Warm up, then confirm the bridge is actually live before measuring.
await page.keyboard.type("calentando ");
await page.waitForTimeout(800);
const warm = await page.evaluate(() => (window.__wcSyncSamples?.length ?? 0));
if (!warm) {
  console.log("RESULT: NO SYNC — typing produced no engine round trip; the bridge is not live.");
  const banners = await page.evaluate(() => [...document.querySelectorAll(".fui-MessageBarBody")].map((n) => n.textContent));
  console.log("UI messages:", JSON.stringify(banners));
  await browser.close();
  process.exit(2);
}

await page.evaluate(() => { window.__wcSyncSamples = []; window.__wcPerceived = []; });

for (const ch of TEXT) await page.keyboard.type(ch);
await page.waitForTimeout(1200);

// Bold and italic through the editor's own keymap, still no structural edit.
await page.keyboard.down("Shift");
for (let i = 0; i < 6; i += 1) await page.keyboard.press("ArrowLeft");
await page.keyboard.up("Shift");
await page.keyboard.press("Control+b");
await page.waitForTimeout(500);
await page.keyboard.press("Control+i");
await page.waitForTimeout(900);

const data = await page.evaluate(async () => {
  const snapshot = await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
  const engineText = snapshot.blocks.map((b) => b.runs.map((r) => r.text).join("")).join("");
  return {
    samples: window.__wcSyncSamples ?? [],
    perceived: window.__wcPerceived ?? [],
    engineHasText: engineText.includes("ñandú, canción, jamón y niño"),
    viewText: document.querySelector(".ProseMirror")?.textContent ?? "",
    banners: [...document.querySelectorAll(".fui-MessageBarBody")].map((n) => n.textContent),
  };
});

console.log("=== TYPING ONLY (no structural edits, no re-seed) ===");
console.log("keystrokes:", TEXT.length, " round trips:", data.samples.length);
console.log("engine applying (ms):", JSON.stringify(stats(data.samples.map((s) => s.engineMs))));
console.log("key -> view updated (ms):", JSON.stringify(stats(data.perceived)));
console.log("key -> engine confirmation (ms):", JSON.stringify(stats(data.samples.map((s) => s.roundTripMs))));
console.log("engine holds the accented text:", data.engineHasText);
console.log("ops per round trip:", JSON.stringify(stats(data.samples.map((s) => s.ops))));
if (data.banners.length) console.log("UI messages:", JSON.stringify(data.banners));

// Second pass: type with a pause between keys, so the event loop is idle when each invoke is
// sent. If the confirmation collapses to the transport floor, the cost is WebView2 scheduling a
// frame-bound response, not our code.
await page.evaluate(() => { window.__wcSyncSamples = []; });
for (const ch of "despacio ") await page.keyboard.type(ch, { delay: 60 });
await page.waitForTimeout(800);
const slow = await page.evaluate(() => window.__wcSyncSamples ?? []);
console.log("=== TYPING WITH A PAUSE BETWEEN KEYS (event loop idle) ===");
console.log("key -> engine confirmation (ms):", JSON.stringify(stats(slow.map((s) => s.roundTripMs))));
console.log("engine applying (ms):", JSON.stringify(stats(slow.map((s) => s.engineMs))));

const p50 = stats(data.samples.map((s) => s.roundTripMs)).n ? stats(data.samples.map((s) => s.roundTripMs)).p50 : null;
console.log("VERDICT confirmation p50:", p50, p50 !== null && p50 < 10 ? "(single digit achieved)" : "(still two digits)");
await page.screenshot({ path: "verify-latency.png" });
await browser.close();
