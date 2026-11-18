import type { CommandSpec } from "../bridge/engine";

/** True on Apple platforms, where `Mod` means ⌘ rather than Ctrl. */
export const isApple = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Render an engine shortcut (`"Mod+Shift+>"`) the way the platform writes it (`"Ctrl+Shift+>"`),
 * for tooltips and screen readers.
 */
export function formatShortcut(spec: string): string {
  const apple = isApple();
  return spec
    .split("+")
    .map((part) => {
      const p = part.trim();
      if (p === "Mod") return apple ? "⌘" : "Ctrl";
      if (p === "Shift") return apple ? "⇧" : "Shift";
      if (p === "Alt") return apple ? "⌥" : "Alt";
      if (p === "Ctrl") return apple ? "⌃" : "Ctrl";
      return p;
    })
    .join(apple ? "" : "+");
}

/** The `aria-keyshortcuts` form of an engine shortcut, which must use DOM modifier names. */
export function ariaShortcut(spec: string): string {
  return spec
    .split("+")
    .map((part) => {
      const p = part.trim();
      if (p === "Mod") return isApple() ? "Meta" : "Control";
      if (p === "Shift") return "Shift";
      if (p === "Alt") return "Alt";
      if (p === "Ctrl") return "Control";
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join("+");
}

/** Whether a keydown event is the command's shortcut. */
export function matchesShortcut(event: KeyboardEvent, spec: string): boolean {
  if (!spec) return false;
  // A command may advertise alternatives, e.g. "Mod+B / Mod+Shift+B".
  return spec.split(" / ").some((alternative) => matchesOne(event, alternative.trim()));
}

function matchesOne(event: KeyboardEvent, spec: string): boolean {
  const parts = spec.split("+");
  const key = parts[parts.length - 1] ?? "";
  const mods = parts.slice(0, -1).map((m) => m.trim().toLowerCase());
  const apple = isApple();

  const wantCtrl = mods.includes("ctrl");
  const wantMeta = mods.includes("mod") ? apple : mods.includes("meta");
  const wantCtrlExact = mods.includes("mod") ? !apple : wantCtrl;
  const wantShift = mods.includes("shift");
  const wantAlt = mods.includes("alt");

  if (wantCtrlExact !== event.ctrlKey) return false;
  if (wantMeta !== event.metaKey) return false;
  if (wantShift !== event.shiftKey) return false;
  if (wantAlt !== event.altKey) return false;

  if (key.length === 1) {
    // Letters compare case-insensitively; symbols such as ">" must match exactly, because
    // Shift+"." is how ">" is typed on most layouts.
    return /[a-z]/i.test(key)
      ? event.key.toLowerCase() === key.toLowerCase()
      : event.key === key;
  }
  return event.key.toLowerCase() === key.toLowerCase();
}

/** Index a catalog by shortcut, so a keydown is one lookup instead of a scan. */
export function shortcutIndex(catalog: CommandSpec[]): Map<string, CommandSpec> {
  const map = new Map<string, CommandSpec>();
  for (const command of catalog) {
    for (const alternative of command.shortcut.split(" / ")) {
      const key = alternative.trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, command);
    }
  }
  return map;
}
