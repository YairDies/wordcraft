/**
 * Measures the real typing loop in the running desktop app: key -> ProseMirror -> Tauri IPC ->
 * Rust engine -> delta -> view.
 *
 * It attaches to the app's WebView2 over the Chrome DevTools Protocol, which is why the app must
 * be started with:
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *
 * Besides timing, it proves the engine really is the authority: it asks the engine for its own
 * snapshot and compares it with what the editor is displaying.
 */
import { chromium } from "playwright";

const CDP = process.argv[2] ?? "http://127.0.0.1:9222";
// Deliberately full of accents and an enye: the bridge crosses a UTF-16 (JavaScript) to UTF-8
// (Rust) boundary on every offset, and Spanish text is the case that would break it.
const TYPED = "escribo rápido: ñandú, canción, jamón y niño";

function stats(values) {
  if (!values.length) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))];
  return {
    n: sorted.length,
    p50: +at(0.5).toFixed(2),
    p95: +at(0.95).toFixed(2),
    p99: +at(0.99).toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
  };
}

const browser = await chromium.connectOverCDP(CDP);
const pages = browser.contexts().flatMap((c) => c.pages());
if (!pages.length) throw new Error("no pages exposed over CDP");
const page = pages[0];
page.setDefaultTimeout(30000);
// Start from a clean document every run: the app keeps its window between measurements.
await page.reload({ waitUntil: "networkidle" });

await page.waitForSelector(".ProseMirror", { timeout: 30000 });
await page.setInputFiles("input[type=file]", "samples/welcome.docx");
await page.waitForTimeout(2500);

// The engine must have been seeded by the import.
const seeded = await page.evaluate(async () => {
  const snapshot = await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
  return { blocks: snapshot.blocks.length, first: snapshot.blocks[0]?.runs?.map((r) => r.text).join("") ?? "" };
});
console.log("engine seeded from the imported document:", JSON.stringify(seeded));

// Clear the sample buffer, then type one character at a time and let each round trip settle.
await page.evaluate(() => {
  window.__wcSyncSamples = [];
});
// Measure what the person actually experiences: from the key event to the document changing.
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
// Warm up the IPC path, then measure only warm round trips.
await page.keyboard.type("calentando ");
await page.waitForTimeout(700);
await page.evaluate(() => {
  window.__wcSyncSamples = [];
});
for (const ch of TYPED) {
  await page.keyboard.type(ch);
}

// Wait for the last round trip to land.
await page.waitForFunction(() => (window.__wcSyncSamples?.length ?? 0) >= 1, null, { timeout: 15000 });
await page.waitForTimeout(600);

const data = await page.evaluate(async (typed) => {
  const samples = window.__wcSyncSamples ?? [];
  const snapshot = await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
  const engineBlocks = snapshot.blocks.map((b) => b.runs.map((r) => r.text).join(""));
  const viewBlocks = [...document.querySelectorAll(".ProseMirror > *")].map((n) => n.textContent ?? "");
  // Only paragraphs are engine-owned in this cycle: lists and tables are seeded as empty
  // placeholders so block indices stay aligned, and their text is not part of the engine model.
  const index = viewBlocks.findIndex((t) => t.toLocaleLowerCase().includes(typed.toLocaleLowerCase()));
  return {
    samples,
    perceived: window.__wcPerceived ?? [],
    banners: [...document.querySelectorAll(".fui-MessageBarBody")].map((n) => n.textContent),
    engineBlocks,
    viewBlocks,
    editedIndex: index,
    engineEdited: index >= 0 ? engineBlocks[index] : null,
    viewEdited: index >= 0 ? viewBlocks[index] : null,
    engineTail: engineBlocks.slice(-2),
    viewTail: viewBlocks.slice(-2),
  };
}, TYPED);

// How long an empty round trip costs: this is WebView2 IPC + Tauri, with no work in between.
const transport = await page.evaluate(async () => {
  const timings = [];
  for (let i = 0; i < 25; i += 1) {
    const t0 = performance.now();
    await window.__TAURI_INTERNALS__.invoke("sync_snapshot", {});
    timings.push(performance.now() - t0);
  }
  return timings;
});

const roundTrips = data.samples.map((s) => s.roundTripMs);
const engineTimes = data.samples.map((s) => s.engineMs);
console.log("=== TYPING LOOP ===");
console.log("round trips recorded:", data.samples.length, "for", TYPED.length, "characters");
console.log("round trip ms:", JSON.stringify(stats(roundTrips)));
console.log("engine only ms:", JSON.stringify(stats(engineTimes)));
console.log("empty round trip ms (transport floor):", JSON.stringify(stats(transport)));

const normalise = (s) => (s ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
const engineHasTyped = data.engineBlocks.some((t) => normalise(t).includes(normalise(TYPED)));
const viewHasTyped = data.viewBlocks.some((t) => normalise(t).includes(normalise(TYPED)));
const same = data.engineEdited !== null && normalise(data.engineEdited) === normalise(data.viewEdited);

console.log("=== AUTHORITY CHECK ===");
console.log("edited paragraph index in the view:", data.editedIndex);
console.log("engine holds the typed text:", engineHasTyped);
console.log("view shows the typed text:", viewHasTyped);
console.log("edited paragraph: engine == view:", same);
if (!same) {
  console.log("engine:", JSON.stringify(data.engineEdited));
  console.log("view  :", JSON.stringify(data.viewEdited));
}
console.log("perceived keydown->paint ms:", JSON.stringify(stats(data.perceived)));
if (data.banners?.length) console.log("UI messages:", JSON.stringify(data.banners));
console.log("engine tail:", JSON.stringify(data.engineTail));
console.log("view tail  :", JSON.stringify(data.viewTail));

const p95 = stats(roundTrips).p95 ?? Number.POSITIVE_INFINITY;
const checks = {
  engineSeeded: seeded.blocks > 0,
  roundTripsRecorded: data.samples.length > 0,
  engineHoldsTyped: engineHasTyped,
  viewShowsTyped: viewHasTyped,
  engineIsAuthority: same,
  engineWithinFrame: (stats(engineTimes).p95 ?? Infinity) < 16,
  perceivedWithinFrame: (stats(data.perceived).p50 ?? Infinity) < 16,
  // Reported, not enforced: the confirmation contends with rendering for the next frame.
  roundTripWithinFrame: p95 < 16,
};
console.log("=== CHECKS ===");
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
const allOk = Object.values(checks).every(Boolean);
console.log(allOk ? "RESULT: PASS" : "RESULT: FAIL");
await page.screenshot({ path: "verify-sync.png" });
await browser.close();
process.exit(allOk ? 0 : 1);
