/** UI languages the ribbon is written in. Word's shortcuts change with the UI language. */
export type Locale = "es" | "en";

const STORAGE_KEY = "wc.locale";

export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "es" || stored === "en") return stored;
  } catch {
    // Storage can be unavailable; fall through to the browser's language.
  }
  const language = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "en";
  return language.startsWith("es") ? "es" : "en";
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // A locked store only costs persistence, not correctness.
  }
}
