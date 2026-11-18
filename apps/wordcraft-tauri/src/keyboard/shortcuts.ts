import { useCallback, useEffect, useState } from "react";
import { commandKeys } from "./map";
import type { Locale } from "./locale";

/**
 * Resolves a command's keyboard identity, applying the person's own reassignments on top of the
 * language defaults.
 *
 * Shortcuts are customisable (Word: File ▸ Options ▸ Customise Ribbon ▸ Keyboard); keytips are
 * not, because Word never lets a ribbon keytip be reassigned — only the accelerator.
 */
const STORAGE_KEY = "wc.shortcutOverrides";

type Overrides = Record<string, string>;

function load(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const out: Overrides = {};
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim()) out[id] = value.trim();
      }
      return out;
    }
  } catch {
    // A corrupt store must not take the keyboard down with it.
  }
  return {};
}

export interface ShortcutApi {
  locale: Locale;
  /** The accelerator in effect for a command: the person's reassignment, else the language default. */
  shortcutFor: (id: string) => string;
  /** The fixed keytip for a command. */
  keytipFor: (id: string) => string;

  labelFor: (id: string) => string;
  /** Accelerators a reassignment would collide with. */
  ownerOf: (accelerator: string) => string | null;
  assign: (id: string, accelerator: string) => void;
  reset: (id: string) => void;
  overrides: Overrides;
}

export function useShortcuts(locale: Locale): ShortcutApi {
  const [overrides, setOverrides] = useState<Overrides>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch {
      // Persistence is a convenience; the session still honours the change.
    }
  }, [overrides]);

  const shortcutFor = useCallback(
    (id: string) => {
      const custom = overrides[id];
      if (custom !== undefined) return custom;
      return commandKeys(id)?.shortcut[locale] ?? "";
    },
    [overrides, locale],
  );

  const keytipFor = useCallback((id: string) => commandKeys(id)?.keytip[locale] ?? "", [locale]);
  const labelFor = useCallback((id: string) => commandKeys(id)?.label[locale] ?? id, [locale]);

  const ownerOf = useCallback(
    (accelerator: string) => {
      const normalised = accelerator.trim().toLowerCase();
      if (!normalised) return null;
      for (const command of [...Object.keys(overrides), "format.bold", "format.italic", "format.underline", "edit.undo", "edit.redo", "edit.copy", "edit.cut", "edit.paste", "edit.find"]) {
        const commandId = command;
        if (shortcutFor(commandId).toLowerCase() === normalised) return commandId;
      }
      return null;
    },
    [overrides, shortcutFor],
  );

  const assign = useCallback((id: string, accelerator: string) => {
    setOverrides((current) => ({ ...current, [id]: accelerator.trim() }));
  }, []);

  const reset = useCallback((id: string) => {
    setOverrides((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  return { locale, shortcutFor, keytipFor, labelFor, ownerOf, assign, reset, overrides };
}

/** Whether a keyboard event is the given accelerator. `Mod` is Ctrl, or ⌘ on macOS. */
export function matchesAccelerator(event: KeyboardEvent, accelerator: string): boolean {
  if (!accelerator) return false;
  const apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const parts = accelerator.split("+");
  const key = parts[parts.length - 1] ?? "";
  const mods = parts.slice(0, -1).map((m) => m.trim().toLowerCase());

  const wantsMod = mods.includes("mod");
  const wantsCtrl = (wantsMod && !apple) || mods.includes("ctrl");
  const wantsMeta = (wantsMod && apple) || mods.includes("meta");
  const wantsShift = mods.includes("shift");
  const wantsAlt = mods.includes("alt");

  if (wantsCtrl !== event.ctrlKey) return false;
  if (wantsMeta !== event.metaKey) return false;
  if (wantsShift !== event.shiftKey) return false;
  if (wantsAlt !== event.altKey) return false;

  if (key.length === 1) {
    return /[a-z]/i.test(key) ? event.key.toLowerCase() === key.toLowerCase() : event.key === key;
  }
  return event.key.toLowerCase() === key.toLowerCase();
}

/** An accelerator in the form `aria-keyshortcuts` expects. */
export function toAriaShortcut(accelerator: string): string {
  if (!accelerator) return "";
  const apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return accelerator
    .split("+")
    .map((part) => {
      const p = part.trim();
      if (p === "Mod") return apple ? "Meta" : "Control";
      if (p === "Ctrl") return "Control";
      if (p.length === 1) return p.toUpperCase();
      return p;
    })
    .join("+");
}

/** An accelerator as the platform writes it, for tooltips and screen readers. */
export function formatAccelerator(accelerator: string): string {
  if (!accelerator) return "";
  const apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return accelerator
    .split("+")
    .map((part) => {
      const p = part.trim();
      if (p === "Mod") return apple ? "⌘" : "Ctrl";
      if (p === "Ctrl") return apple ? "⌃" : "Ctrl";
      if (p === "Shift") return apple ? "⇧" : "Shift";
      if (p === "Alt") return apple ? "⌥" : "Alt";
      return p;
    })
    .join(apple ? "" : "+");
}
