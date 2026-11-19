import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { RIBBON } from "../ribbon/curated";
import type { ShortcutApi } from "./shortcuts";

/**
 * Keytips, implemented here rather than with @fluentui-contrib/react-keytips.
 *
 * The package is experimental and cost more than it gave: it overwrote `aria-keyshortcuts` with
 * its own key sequence, duplicated a tab's label so it read "FileFile" to a screen reader, and its
 * portal covered the window with pointer events on, swallowing every click aimed at the document.
 * Owning the loop is a few dozen lines and every part of it is visible.
 *
 * Word's model is reproduced exactly:
 *   Alt          → first level: the tabs
 *   Alt, H       → Inicio / Home
 *   Alt, H, B    → the Bold command inside Home
 *   Esc          → leave keytip mode
 */
export type KeytipMode = null | "root" | string;

interface KeytipsApi {
  mode: KeytipMode;
  setMode: (mode: KeytipMode) => void;
}

const KeytipsContext = createContext<KeytipsApi>({ mode: null, setMode: () => {} });

const isLetter = (key: string) => key.length === 1 && /[a-z0-9]/i.test(key);

interface ProviderProps {
  shortcuts: ShortcutApi;
  onRun: (id: string) => void;
  children: ReactNode;
}

/**
 * Holds the keytip mode and owns the keyboard while it is active.
 *
 * One window listener, capture phase, and it only acts when a mode is active — Alt alone enters
 * it, and any key that is not part of a sequence leaves it.
 */
export function KeytipsProvider({ shortcuts, onRun, children }: ProviderProps) {
  const [mode, setMode] = useState<KeytipMode>(null);

  /** The command in a tab whose keytip is `key`, if any. */
  const commandFor = useCallback(
    (tabId: string, key: string): string | null => {
      const tab = RIBBON.find((entry) => entry.id === tabId);
      if (!tab) return null;
      for (const group of tab.groups) {
        for (const item of group.items) {
          if (shortcuts.keytipFor(item.id).toLowerCase() === key.toLowerCase()) return item.id;
        }
        // A group's dialog launcher is reachable by keytip too: Alt+H, P opens Paragraph.
        if (group.launcher && shortcuts.keytipFor(group.launcher).toLowerCase() === key.toLowerCase()) {
          return group.launcher;
        }
      }
      return null;
    },
    [shortcuts],
  );

  const tabFor = useCallback(
    (key: string): string | null => {
      for (const tab of RIBBON) {
        if (shortcuts.keytipFor(tab.id).toLowerCase() === key.toLowerCase()) return tab.id;
      }
      return null;
    },
    [shortcuts],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Alt on its own toggles keytip mode, as in Word.
      if (event.key === "Alt" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        setMode((current) => (current === null ? "root" : null));
        return;
      }
      if (mode === null) return;

      if (event.key === "Escape") {
        event.preventDefault();
        setMode(null);
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) {
        // A real accelerator, not a keytip sequence: leave the mode and let it through.
        setMode(null);
        return;
      }
      if (!isLetter(event.key)) {
        setMode(null);
        return;
      }

      event.preventDefault();
      const key = event.key;
      if (mode === "root") {
        const tab = tabFor(key);
        setMode(tab);
        return;
      }
      const command = commandFor(mode, key);
      setMode(null);
      if (command) onRun(command);
    };

    // Capture, so a keytip sequence is not also typed into the document.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mode, commandFor, tabFor, onRun]);

  const api = useMemo(() => ({ mode, setMode }), [mode]);
  return <KeytipsContext.Provider value={api}>{children}</KeytipsContext.Provider>;
}

export const useKeytipsMode = (): KeytipsApi => useContext(KeytipsContext);

interface KeytipProps {
  /** Where the keytip is shown: `root` for the tabs, or a tab id for its commands. */
  scope: "root" | string;
  sequence: string;
  /** How the badge is placed over its control. */
  placement?: "top" | "bottom";
}

/**
 * The badge itself: a positioned span over the control, with no portal and no pointer events.
 * The portal was the cause of the click-swallowing bug, so there is none.
 */
export function Keytip({ scope, sequence, placement = "top" }: KeytipProps) {
  const { mode } = useKeytipsMode();
  if (!mode || mode !== scope || !sequence) return null;
  return (
    <span
      aria-hidden="true"
      data-keytip={sequence}
      style={{
        position: "absolute",
        [placement]: "-6px",
        left: "50%",
        transform: "translateX(-50%)",
        padding: "1px 5px",
        borderRadius: "3px",
        background: "#1a1a1a",
        color: "#ffffff",
        fontSize: "10px",
        lineHeight: "14px",
        fontWeight: 600,
        pointerEvents: "none",
        zIndex: 1000,
        whiteSpace: "nowrap",
      }}
    >
      {sequence}
    </span>
  );
}

/** Wraps a control so its keytip badge has something to sit on. */
export function KeytipAnchor({ children }: { children: ReactNode }) {
  return <span style={{ position: "relative", display: "inline-block" }}>{children}</span>;
}
